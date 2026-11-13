// Sign-in by emailed one-time code. There is no password: a code sent to an
// address is the whole sign-in, and the first sign-in makes the account.
// While SIGNUP_MODE is "waitlist", a new account is signed in but waiting:
// the site shows it the waitlist until an admin approves it (admin.ts).
//
//   POST /auth/code     { email }        emails a code
//   POST /auth/verify   { email, code }  checks it and starts a session
//   GET  /auth/session                   who the session cookie belongs to
//   POST /auth/profile  { name }         changes the signed-in account's name
//   POST /auth/signout                   ends the session

import type { Env } from "./env";
import { HttpError, json, readJson, readSessionCookie, sessionCookie } from "./http";
import { countRequest, uncountRequests } from "./limits";
import { sendCodeEmail } from "./mail";
import {
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  DAY,
  LIMITS,
  MESSAGES,
  NAME_MAX_LENGTH,
  RESEND_COOLDOWN_MS,
  SESSION_TTL_MS,
} from "./rules";
import { codeHash, isToken, newCode, newToken, sameHash, tokenHash } from "./tokens";

/** What the site is told about the signed-in account. `name` is null until one is given. */
export type PublicUser = { email: string; name: string | null; waiting: boolean; admin: boolean };

type UserRow = { id: string; email: string; status: string; name: string | null };

/** Whether anyone who signs in may use the console; anything but "open" keeps the waitlist. */
export function isOpen(env: Env) {
  return env.SIGNUP_MODE === "open";
}

/** The admins' addresses, normalized like any other. */
export function adminEmails(env: Env) {
  return new Set((env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter((e): e is string => !!e));
}

/** An account waits only while sign-up is on the waitlist, until approved; admins never wait. */
function publicUser(row: UserRow, env: Env): PublicUser {
  const admin = adminEmails(env).has(row.email);
  return { email: row.email, name: row.name, waiting: !admin && !isOpen(env) && row.status !== "approved", admin };
}

// Characters a name can't hold: control characters, and the bidirectional
// overrides and isolates that would let a name display as something else.
const NOT_IN_A_NAME = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

/**
 * A name as it is kept: trimmed, with runs of spaces made one, or null for none (absent or empty).
 * Anything else, or a name longer than NAME_MAX_LENGTH characters, is refused.
 */
export function readName(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, MESSAGES.badName);
  const name = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if ([...name].length > NAME_MAX_LENGTH || NOT_IN_A_NAME.test(name)) throw new HttpError(400, MESSAGES.badName);
  return name || null;
}

/** An address in the form accounts are kept under, or null if it isn't one. */
export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(email) ? email : null;
}

// Cloudflare sets this from the connection, so callers can't choose it. An
// IPv6 host is usually given a whole /64, so the limits per network count an
// IPv6 address by its /64: otherwise each new address would get fresh limits.
function network(request: Request) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return ip.includes(":") ? ipv6Network(ip) : ip;
}

/** "2001:db8:1:2::/64" for any address in that /64; the address itself if it can't be read. */
function ipv6Network(ip: string) {
  // An IPv4 address written as IPv6 (::ffff:192.0.2.1) is its own network.
  if (ip.includes(".")) return ip;
  const halves = ip.split("::");
  if (halves.length > 2) return ip;
  const [head, tail] = halves.map((half) => (half ? half.split(":") : []));
  const groups = tail ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return ip;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

function cooldown(waitMs: number) {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  return new HttpError(429, MESSAGES.wait(seconds), { "Retry-After": String(seconds) });
}

/** The secret codes are hashed under. Without it, or the Resend key, sign-in is unavailable. */
function authSecret(env: Env) {
  if (!env.RESEND_API_KEY || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    console.error("sign-in is not configured: set RESEND_API_KEY and an AUTH_SECRET of 32+ characters");
    throw new HttpError(503, MESSAGES.unavailable);
  }
  return env.AUTH_SECRET;
}

export async function sendCode(request: Request, env: Env, now: number) {
  const secret = authSecret(env);
  const email = normalizeEmail((await readJson(request)).email);
  if (!email) throw new HttpError(400, MESSAGES.badEmail);
  const db = env.DB;

  await countRequest(db, `code:network:${network(request)}`, LIMITS.codesPerNetwork, now, MESSAGES.tooManyFromNetwork);
  const last = await db.prepare("SELECT sent_at FROM sign_in_codes WHERE email = ?").bind(email).first<{ sent_at: number }>();
  if (last && now < last.sent_at + RESEND_COOLDOWN_MS) throw cooldown(last.sent_at + RESEND_COOLDOWN_MS - now);
  await countRequest(db, `code:address:${email}`, LIMITS.codesPerAddressHour, now, MESSAGES.tooManyForAddress);
  await countRequest(db, `code:address-day:${email}`, LIMITS.codesPerAddressDay, now, MESSAGES.tooManyForAddress);
  // The address's limits count codes sent, so a request that ends up sending
  // none (another one won the minute, or the email failed) gives its count back.
  const uncount = () =>
    uncountRequests(
      db,
      [
        [`code:address:${email}`, LIMITS.codesPerAddressHour],
        [`code:address-day:${email}`, LIMITS.codesPerAddressDay],
      ],
      now,
    );

  // The new code replaces the last one, unless another request sent one in
  // the last minute: the condition makes that check and the write one step.
  const code = newCode();
  const hash = await codeHash(secret, email, code);
  const saved = await db
    .prepare(
      `INSERT INTO sign_in_codes (email, code_hash, sent_at, expires_at, attempts) VALUES (?1, ?2, ?3, ?4, 0)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = excluded.code_hash, sent_at = excluded.sent_at, expires_at = excluded.expires_at, attempts = 0
       WHERE sign_in_codes.sent_at <= ?5
       RETURNING email`,
    )
    .bind(email, hash, now, now + CODE_TTL_MS, now - RESEND_COOLDOWN_MS)
    .first();
  if (!saved) {
    await uncount();
    throw cooldown(RESEND_COOLDOWN_MS);
  }

  try {
    await sendCodeEmail(env, email, code);
  } catch (error) {
    // A code nobody received shouldn't hold the address to the minute's wait.
    await db.prepare("DELETE FROM sign_in_codes WHERE email = ? AND code_hash = ?").bind(email, hash).run();
    await uncount();
    throw error;
  }
  return json({ sent: true });
}

export async function verifyCode(request: Request, env: Env, now: number) {
  const secret = authSecret(env);
  const body = await readJson(request);
  const db = env.DB;
  await countRequest(db, `check:network:${network(request)}`, LIMITS.checksPerNetwork, now, MESSAGES.tooManyFromNetwork);

  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || code.length !== CODE_LENGTH || !/^\d+$/.test(code)) throw new HttpError(400, MESSAGES.wrongCode);
  // Sign-up may send the name to start the account with; it is checked before
  // the code, so a name that can't be kept doesn't use up a try.
  const name = readName(body.name);

  // Every check uses up one of the code's tries, right or wrong.
  const live = await db
    .prepare(
      `UPDATE sign_in_codes SET attempts = attempts + 1
       WHERE email = ?1 AND expires_at > ?2 AND attempts < ?3
       RETURNING code_hash`,
    )
    .bind(email, now, CODE_MAX_ATTEMPTS)
    .first<{ code_hash: string }>();
  if (!live) throw new HttpError(401, MESSAGES.wrongCode);

  const hash = await codeHash(secret, email, code);
  if (!sameHash(hash, live.code_hash)) {
    await db.prepare("DELETE FROM sign_in_codes WHERE email = ? AND attempts >= ?").bind(email, CODE_MAX_ATTEMPTS).run();
    throw new HttpError(401, MESSAGES.wrongCode);
  }
  // Single use: of two checks with the same code, only the one that deletes
  // it signs in. A newer code sent in between makes this one stale.
  const used = await db
    .prepare("DELETE FROM sign_in_codes WHERE email = ? AND code_hash = ? RETURNING email")
    .bind(email, hash)
    .first();
  if (!used) throw new HttpError(401, MESSAGES.wrongCode);

  // A new account joins the waitlist unless sign-up is open or it is an
  // admin's; an existing one keeps its status. Either way the address is
  // proven, so the session starts: a waiting account sees the waitlist and
  // nothing else. A name sent along names a new account, or one without a
  // name yet; it never replaces a name the account already has.
  const user = await db
    .prepare(
      `INSERT INTO users (id, email, created_at, last_sign_in_at, status, name) VALUES (?1, ?2, ?3, ?3, ?4, ?5)
       ON CONFLICT (email) DO UPDATE SET
         last_sign_in_at = excluded.last_sign_in_at, name = COALESCE(users.name, excluded.name)
       RETURNING id, email, status, name`,
    )
    .bind(crypto.randomUUID(), email, now, isOpen(env) || adminEmails(env).has(email) ? "approved" : "waiting", name)
    .first<UserRow>();
  const token = newToken();
  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(token), user!.id, now, now + SESSION_TTL_MS)
    .run();
  return json({ user: publicUser(user!, env) }, 200, {
    "Set-Cookie": sessionCookie(request, token, SESSION_TTL_MS),
  });
}

/** The account the session cookie belongs to, or null. */
export async function sessionUser(request: Request, env: Env, now: number) {
  const token = readSessionCookie(request);
  if (!token || !isToken(token)) return null;
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, users.status, users.name FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`,
  )
    .bind(await tokenHash(token), now)
    .first<UserRow>();
  return row ? publicUser(row, env) : null;
}

export async function currentSession(request: Request, env: Env, now: number) {
  return json({ user: await sessionUser(request, env, now) });
}

/** Sets or clears (an empty name) the signed-in account's name, and answers with the account. */
export async function updateProfile(request: Request, env: Env, now: number) {
  const name = readName((await readJson(request)).name);
  const signedIn = await sessionUser(request, env, now);
  if (!signedIn) throw new HttpError(401, MESSAGES.signedOut);
  const row = await env.DB.prepare("UPDATE users SET name = ? WHERE email = ? RETURNING id, email, status, name")
    .bind(name, signedIn.email)
    .first<UserRow>();
  // Removed by an admin between the two steps: signed out as far as anyone knows.
  if (!row) throw new HttpError(401, MESSAGES.signedOut);
  return json({ user: publicUser(row, env) });
}

export async function signOut(request: Request, env: Env) {
  const token = readSessionCookie(request);
  if (token && isToken(token)) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await tokenHash(token)).run();
  }
  return json({ signedOut: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
}

/** Deletes what has expired: codes, sessions, and counts from ended windows. */
export async function sweep(db: D1Database, now: number) {
  await db.batch([
    db.prepare("DELETE FROM sign_in_codes WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    // The longest window is a day, so one that started a day ago has ended.
    db.prepare("DELETE FROM rate_limits WHERE window_start <= ?").bind(now - DAY),
  ]);
}
