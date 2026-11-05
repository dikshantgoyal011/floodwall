// Routes, limits and copy for signing in with a one-time code. There is no
// password: the code is the whole sign-in, and a new address makes an account.
// The copy reads as the real, emailed flow; the demo says so beside the code.

import { CONSOLE_PATHS } from "./console";

/**
 * The sign-in service (api/ in this repository), which emails the codes and
 * keeps the session in a cookie. A build without it runs the in-browser demo.
 * site/.env.production sets it for the built site; set it in
 * site/.env.development.local to use a local service.
 */
export const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL?.replace(/\/+$/, "") || null;

export const AUTH_PATHS = {
  login: "/login",
  signup: "/signup",
  account: "/account",
  waitlist: "/waitlist",
} as const;

/** The query parameter that names where to go after signing in. */
export const NEXT_PARAM = "next";

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/** Creating an account opens the console; signing in opens the account page. */
export const DEFAULT_NEXT = { signup: CONSOLE_PATHS.overview, login: AUTH_PATHS.account } as const;

export const AUTH_COPY = {
  login: {
    title: "Sign in",
    lead: "Enter your email address and we will send you a six-digit code.",
    switchPrompt: "No account yet?",
    switchLink: "Create one",
    switchNote: "Signing in with a new address also creates an account.",
  },
  signup: {
    kicker: "Free · $0/month",
    title: "Gate your first agent change.",
    lead: "Create your free account, then open the console with a plane of example intents. No credit card or API key is needed to try it.",
    note: "We will email you a six-digit sign-in code. There is no password. Your account starts on the Free plan.",
    terms: "Creating an account means you accept the terms. The privacy notice lists what we store.",
    switchPrompt: "Already have an account?",
    switchLink: "Sign in",
  },
  form: {
    emailLabel: "Email address",
    send: "Send code",
    sending: "Sending code…",
    /** Wrapped around the address, which is set in bold. */
    sentTo: ["We sent a six-digit code to ", ". It expires in 10 minutes."],
    codeLabel: "Code",
    verify: "Verify and continue",
    verifying: "Checking code…",
    resend: "Resend code",
    resending: "Sending a new code…",
    restart: "Use another address",
    resent: (email: string) => `We sent a new code to ${email}. Use the newest code.`,
    wait: (seconds: number) => `You can ask for a new code in ${seconds} s.`,
    restarted: "You can ask for a new code once a minute.",
    demo: (code: string) => `Demo mode: no email is sent. Your code is ${code}.`,
  },
  account: {
    title: "Your account",
    lead: "Your account connects your sign-in to the console.",
    signedInAs: "Signed in as",
    session: "A session lasts up to 30 days. Signing out ends it in this browser.",
    console: "Open the console",
    signOut: "Sign out",
    signingOut: "Signing out…",
  },
  waitlist: {
    kicker: "Beta",
    title: "You're on the waitlist.",
    lead: "Floodwall is in beta, and we're letting people in a few at a time.",
    /** Wrapped around the address, which is set in bold. */
    willEmail: ["We'll email ", " as soon as your account is approved. You don't need to do anything else."],
    check: "Check again",
    checking: "Checking…",
    stillWaiting: "Still waiting for approval. We'll email you when it's done.",
  },
  /** When the sign-in service can't be asked, or gives no reason of its own. */
  service: {
    unreachable: "We could not reach the sign-in service. Check your connection and try again.",
    failed: "Something went wrong. Please try again.",
  },
  signOut: "Sign out",
  signOutFailed: "Could not sign out. Check your connection and try again.",
};
