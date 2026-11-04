// Sign-in by one-time code. The client is the one place that knows where
// codes come from: the sign-in service, or the in-browser demo without one.

export type AuthUser = { email: string };

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
