// Sign-in by one-time code. With AUTH_API_URL set, the sign-in service (api/
// in this repository) emails the code and keeps the session in a cookie the
// page can't read. Without it, a demo runs in the browser: the code is shown
// on the page instead of emailed. The demo keeps the service's rules (one
// code a minute, ten minutes to use it, five tries, single use) so the flow
// behaves the same either way.

import {
  AUTH_API_URL,
  AUTH_COPY,
  AUTH_PATHS,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  DEFAULT_NEXT,
  NEXT_PARAM,
  RESEND_COOLDOWN_MS,
  SESSION_TTL_MS,
} from "../constants/auth";
import { CONSOLE_PATHS } from "../constants/console";
import type { AuthClient, AuthUser } from "../types/auth";

/**
 * Where to go after signing in. `next` comes from the URL, so only the
 * account page and console paths are honoured; anything else, an outside
 * URL included, falls back to the page's default.
 */
export function safeNext(page: keyof typeof DEFAULT_NEXT, next: string | null) {
  const console = CONSOLE_PATHS.overview;
  const allowed = next === AUTH_PATHS.account || next === console || !!next?.startsWith(`${console}/`);
  return allowed ? next! : DEFAULT_NEXT[page];
}

/** What the site calls an account: its name, or its address until it has one. */
export function accountLabel(user: AuthUser) {
  return user.name ?? user.email;
}

/**
 * The letters on an account's avatar: the first letters of its name's first and last words ("AL"
 * for Ada Lovelace), or its address's first letter or digit, capitalised.
 */
export function accountInitials(user: AuthUser) {
  const words = user.name?.split(" ").filter(Boolean) ?? [];
  if (words.length) {
    const first = (word: string) => [...word][0];
    return (words.length > 1 ? first(words[0]) + first(words.at(-1)!) : first(words[0])).toUpperCase();
  }
  return (user.email.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
}

/** The sign-in page, coming back to `next` afterwards. */
export function loginPath(next: string) {
  return `${AUTH_PATHS.login}?${new URLSearchParams({ [NEXT_PARAM]: next })}`;
}

const WRONG_CODE = "That code is wrong or has expired. Check the newest code, or ask for a new one.";

// The pending code lives in sessionStorage, so it only works in the tab's
// browser session that asked for it; the session lives in localStorage.
const CHALLENGE_KEY = "floodwall.auth.challenge";
const SESSION_KEY = "floodwall.auth.session";

type Challenge = { email: string; code: string; sentAt: number; attempts: number };
type StoredSession = { email: string; name?: string | null; expiresAt: number };

/** A name as the service keeps it: runs of spaces made one, trimmed; empty is none. */
const tidyName = (name = "") => name.replace(/\s+/g, " ").trim() || null;

// Storage can throw (private windows, blocked site data): that reads as empty.
function read<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // The sign-in just won't survive a reload.
  }
}

const session = () => sessionStorage;
const local = () => localStorage;

function randomCode() {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, "0");
}

const demoClient: AuthClient = {
  async sendCode(email) {
    const last = read<Challenge>(session, CHALLENGE_KEY);
    const wait = last && last.email === email ? last.sentAt + RESEND_COOLDOWN_MS - Date.now() : 0;
    if (wait > 0) throw new Error(`You can ask for a new code in ${Math.ceil(wait / 1000)} s.`);
    const code = randomCode();
    write(session, CHALLENGE_KEY, { email, code, sentAt: Date.now(), attempts: 0 });
    return { code };
  },
  async verifyCode(email, code, name) {
    const challenge = read<Challenge>(session, CHALLENGE_KEY);
    if (!challenge || challenge.email !== email || Date.now() > challenge.sentAt + CODE_TTL_MS) {
      throw new Error(WRONG_CODE);
    }
    if (challenge.code !== code) {
      const attempts = challenge.attempts + 1;
      // Five wrong tries use the code up.
      write(session, CHALLENGE_KEY, attempts >= CODE_MAX_ATTEMPTS ? null : { ...challenge, attempts });
      throw new Error(WRONG_CODE);
    }
    write(session, CHALLENGE_KEY, null);
    // The demo keeps no accounts: the name lives with the session, so signing out forgets it.
    write(local, SESSION_KEY, { email, name: tidyName(name), expiresAt: Date.now() + SESSION_TTL_MS });
  },
  async getUser() {
    const stored = read<StoredSession>(local, SESSION_KEY);
    // The demo has no waitlist and no admins.
    return stored && stored.expiresAt > Date.now()
      ? { email: stored.email, name: stored.name ?? null, waiting: false, admin: false }
      : null;
  },
  async updateProfile(name) {
    const stored = read<StoredSession>(local, SESSION_KEY);
    if (!stored || stored.expiresAt <= Date.now()) throw new Error(AUTH_COPY.service.signedOut);
    write(local, SESSION_KEY, { ...stored, name: tidyName(name) });
    return (await demoClient.getUser())!;
  },
  async signOut() {
    write(local, SESSION_KEY, null);
  },
};

/**
 * Calls the sign-in service: a GET, or a POST of `body` as JSON. The service
 * answers in JSON; a refusal carries a sentence for the reader in `error`,
 * which is thrown as it is.
 */
export async function callService<T>(path: string, body?: object): Promise<T> {
  if (!AUTH_API_URL) throw new Error(AUTH_COPY.service.failed);
  let response: Response;
  try {
    response = await fetch(`${AUTH_API_URL}${path}`, {
      method: body ? "POST" : "GET",
      // The session cookie belongs to the service's host: send it along.
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(AUTH_COPY.service.unreachable);
  }
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !answer) throw new Error(answer?.error ?? AUTH_COPY.service.failed);
  return answer;
}

/** The client for the sign-in service (callService). */
function serviceClient(): AuthClient {
  return {
    async sendCode(email) {
      await callService("/auth/code", { email });
      return {};
    },
    async verifyCode(email, code, name) {
      await callService("/auth/verify", name ? { email, code, name } : { email, code });
    },
    async getUser() {
      return (await callService<{ user: AuthUser | null }>("/auth/session")).user;
    },
    async updateProfile(name) {
      return (await callService<{ user: AuthUser }>("/auth/profile", { name })).user;
    },
    async signOut() {
      await callService("/auth/signout", {});
    },
  };
}

export const authClient = AUTH_API_URL ? serviceClient() : demoClient;
