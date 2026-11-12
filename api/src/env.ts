/** What the Worker is given: its database, three secrets and three settings. */
export interface Env {
  DB: D1Database;
  /** Secret. A Resend API key that can send from MAIL_FROM's domain. */
  RESEND_API_KEY?: string;
  /**
   * Secret, at least 32 characters. Keys the HMAC of each stored code, so a
   * copy of the database is no help in guessing a live code.
   */
  AUTH_SECRET?: string;
  /**
   * Secret, so the addresses stay out of the repository. The admins'
   * addresses, comma-separated: they are never on the waitlist and can
   * approve the people who are.
   */
  ADMIN_EMAILS?: string;
  /** Who sign-in emails come from, e.g. "Floodwall <notifications@floodwall.ai>". */
  MAIL_FROM: string;
  /** The sites that may call the service, comma-separated origins. */
  ALLOWED_ORIGINS: string;
  /**
   * "open": anyone who signs in can use the console. "waitlist" (or anything
   * else): a new account waits until an admin approves it.
   */
  SIGNUP_MODE: string;
}
