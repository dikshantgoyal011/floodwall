// Sign-in by one-time code. The client is the one place that knows where
// codes come from: the sign-in service, or the in-browser demo without one.

/**
 * `waiting`: the account is on the waitlist, so it sees the waitlist page
 * instead of the console. `admin`: it can approve the waitlist. Both are
 * always false in the demo.
 */
export type AuthUser = { email: string; waiting: boolean; admin: boolean };

/** An account as the admin page lists it. */
export type AdminAccount = {
  email: string;
  status: "waiting" | "approved";
  admin: boolean;
  createdAt: number;
  lastSignInAt: number;
  approvedAt: number | null;
  approvedBy: string | null;
};

/** "waitlist": new accounts wait for approval. "open": anyone can sign up. */
export type SignupMode = "waitlist" | "open";

export type AuthSession =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser };

export type AuthClient = {
  /**
   * Sends a six-digit code to `email`. The service emails it and returns no
   * code; the demo returns it so the page can show it.
   */
  sendCode: (email: string) => Promise<{ code?: string }>;
  /** Checks the code and starts a session. Signing in with a new address creates the account. */
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Who is signed in; null when no one is, or the service can't be asked. */
  getUser: () => Promise<AuthUser | null>;
  /** Ends the session, or throws if it couldn't. */
  signOut: () => Promise<void>;
};
