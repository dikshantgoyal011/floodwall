// Sign-in by one-time code, as a demo that runs in the browser: the code is
// shown on the page instead of emailed. It keeps a real service's rules (one
// code a minute, ten minutes to use it, five tries, single use) so the flow
// behaves the same once a code service replaces `authClient`.

import {
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
type StoredSession = AuthUser & { expiresAt: number };

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

export const authClient: AuthClient = {
  async sendCode(email) {
    const last = read<Challenge>(session, CHALLENGE_KEY);
    const wait = last && last.email === email ? last.sentAt + RESEND_COOLDOWN_MS - Date.now() : 0;
    if (wait > 0) throw new Error(`You can ask for a new code in ${Math.ceil(wait / 1000)} s.`);
    const code = randomCode();
    write(session, CHALLENGE_KEY, { email, code, sentAt: Date.now(), attempts: 0 });
    return { code };
  },
  async verifyCode(email, code) {
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
    write(local, SESSION_KEY, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  },
  async getUser() {
    const stored = read<StoredSession>(local, SESSION_KEY);
    return stored && stored.expiresAt > Date.now() ? { email: stored.email } : null;
  },
  async signOut() {
    write(local, SESSION_KEY, null);
  },
};
