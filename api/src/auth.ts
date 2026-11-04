// Sign-in by emailed one-time code. There is no password: a code sent to an
// address is the whole sign-in, and the first sign-in makes the account.
//
//   POST /auth/code     { email }        emails a code
//   POST /auth/verify   { email, code }  checks it and starts a session
//   GET  /auth/session                   who the session cookie belongs to
//   POST /auth/signout                   ends the session

import type { Env } from "./env";
import { HttpError, json, readJson, readSessionCookie, sessionCookie } from "./http";
import { countRequest } from "./limits";
import { sendCodeEmail } from "./mail";
import {
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  DAY,
  LIMITS,
  MESSAGES,
  RESEND_COOLDOWN_MS,
  SESSION_TTL_MS,
} from "./rules";
import { codeHash, isToken, newCode, newToken, sameHash, tokenHash } from "./tokens";

/** An address in the form accounts are kept under, or null if it isn't one. */
export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(email) ? email : null;
}

// Cloudflare sets this from the connection, so callers can't choose it.
function network(request: Request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
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
  if (!saved) throw cooldown(RESEND_COOLDOWN_MS);

  try {
    await sendCodeEmail(env, email, code);
  } catch (error) {
    // A code nobody received shouldn't hold the address to the minute's wait.
    await db.prepare("DELETE FROM sign_in_codes WHERE email = ? AND code_hash = ?").bind(email, hash).run();
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

  const user = await db
    .prepare(
      `INSERT INTO users (id, email, created_at, last_sign_in_at) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (email) DO UPDATE SET last_sign_in_at = excluded.last_sign_in_at
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), email, now)
    .first<{ id: string }>();
  const token = newToken();
  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(token), user!.id, now, now + SESSION_TTL_MS)
    .run();
  return json({ user: { email } }, 200, { "Set-Cookie": sessionCookie(request, token, SESSION_TTL_MS) });
}

export async function currentSession(request: Request, env: Env, now: number) {
  const token = readSessionCookie(request);
  const row =
    token && isToken(token)
      ? await env.DB.prepare(
          `SELECT users.email FROM sessions JOIN users ON users.id = sessions.user_id
           WHERE sessions.id = ? AND sessions.expires_at > ?`,
        )
          .bind(await tokenHash(token), now)
          .first<{ email: string }>()
      : null;
  return json({ user: row ? { email: row.email } : null });
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
