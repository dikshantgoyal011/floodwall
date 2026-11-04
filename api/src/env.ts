/** What the Worker is given: its database, two secrets and two settings. */
export interface Env {
  DB: D1Database;
  /** Secret. A Resend API key that can send from MAIL_FROM's domain. */
  RESEND_API_KEY?: string;
  /**
   * Secret, at least 32 characters. Keys the HMAC of each stored code, so a
   * copy of the database is no help in guessing a live code.
   */
  AUTH_SECRET?: string;
  /** Who sign-in emails come from, e.g. "Floodwall <login@floodwall.ai>". */
  MAIL_FROM: string;
  /** The sites that may call the service, comma-separated origins. */
  ALLOWED_ORIGINS: string;
}
