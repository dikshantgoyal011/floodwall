// Sign-in by one-time code. The client is the one place that knows where
// codes come from: the sign-in service, or the in-browser demo without one.

/**
 * `name`: what the account goes by, or null until one is given; the site
 * shows the address instead. `waiting`: the account is on the waitlist, so it
 * sees the waitlist page instead of the console. `admin`: it can approve the
 * waitlist. Both are always false in the demo.
 */
export type AuthUser = { email: string; name: string | null; waiting: boolean; admin: boolean };

/** An account as the admin page lists it. */
export type AdminAccount = {
  email: string;
  name: string | null;
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
  | { status: "signedIn"; user: AuthUser }
  /** The sign-in service couldn't be asked, so it isn't known whether anyone is signed in. */
  | { status: "unavailable" };

export type AuthClient = {
  /**
   * Sends a six-digit code to `email`. The service emails it and returns no
   * code; the demo returns it so the page can show it.
   */
  sendCode: (email: string) => Promise<{ code?: string }>;
  /**
   * Checks the code and starts a session. Signing in with a new address creates the account;
   * `name`, from sign-up, names it (or an account with no name yet).
   */
  verifyCode: (email: string, code: string, name?: string) => Promise<void>;
  /** Who is signed in, or null when no one is. Throws when the service can't be asked. */
  getUser: () => Promise<AuthUser | null>;
  /** Sets the signed-in account's name, or clears it with an empty one, and returns the account. */
  updateProfile: (name: string) => Promise<AuthUser>;
  /** Ends the session, or throws if it couldn't. */
  signOut: () => Promise<void>;
};
