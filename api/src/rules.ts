// The sign-in rules and what the service says when one is broken. The site
// (site/src/constants/auth.ts) states the same code rules to the reader.

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

export type Limit = { limit: number; windowMs: number };

/**
 * How often codes can be asked for and checked. Five tries a code and twenty
 * codes a day keep guessing an address's code to 100 tries a day; the limits
 * per network slow down anyone working through many addresses.
 */
export const LIMITS = {
  codesPerAddressHour: { limit: 5, windowMs: HOUR },
  codesPerAddressDay: { limit: 20, windowMs: DAY },
  codesPerNetwork: { limit: 30, windowMs: HOUR },
  checksPerNetwork: { limit: 60, windowMs: HOUR },
} satisfies Record<string, Limit>;

/** "1 minute", "25 minutes", "3 hours". */
export function waitText(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes === 1) return "1 minute";
  return minutes < 90 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`;
}

export const MESSAGES = {
  badRequest: "That request could not be read.",
  badEmail: "Enter a valid email address.",
  wrongCode: "That code is wrong or has expired. Check the newest code, or ask for a new one.",
  wait: (seconds: number) => `You can ask for a new code in ${seconds} s.`,
  tooManyFromNetwork: (wait: string) => `Too many sign-in attempts from this network. Try again in ${wait}.`,
  tooManyForAddress: (wait: string) => `Too many codes were sent to this address. Try again in ${wait}.`,
  notSent: "We could not send the email. Please try again in a moment.",
  unavailable: "Sign-in is not available right now. Please try again later.",
  foreignOrigin: "This site cannot use Floodwall sign-in.",
  signedOut: "Sign in first.",
  notAdmin: "Only an admin can do that.",
  noSuchUser: "There is no account for that address.",
  adminStays: "Admins can't be removed here. Take the address out of ADMIN_EMAILS first.",
  notFound: "Not found.",
  broken: "Something went wrong. Please try again.",
};
