// Routes, limits and copy for signing in with a one-time code. There is no
// password: the code is the whole sign-in, and a new address makes an account.
// The copy reads as the real, emailed flow; the demo says so beside the code.

import { CONSOLE_PATHS } from "./console";

export const AUTH_PATHS = {
  login: "/login",
  signup: "/signup",
  account: "/account",
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
  signOut: "Sign out",
};
