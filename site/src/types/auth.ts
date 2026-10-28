// Sign-in by one-time code. The client is the one place that knows where
// codes come from: today the in-browser demo, later a real code service.

export type AuthUser = { email: string };

export type AuthSession =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: AuthUser };

export type AuthClient = {
  /** Makes a six-digit code for `email`. The demo returns it so the page can show it. */
  sendCode: (email: string) => Promise<{ code: string }>;
  /** Checks the code and starts a session. Signing in with a new address creates the account. */
  verifyCode: (email: string, code: string) => Promise<void>;
  getUser: () => Promise<AuthUser | null>;
  signOut: () => Promise<void>;
};
