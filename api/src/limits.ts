// Counting requests in fixed windows, kept in D1 so every Cloudflare
// location shares the same count.

import { HttpError } from "./http";
import { waitText, type Limit } from "./rules";

/**
 * Counts one more request under `key` and refuses it, with a 429, once the
 * window holds more than the limit allows. `message` says how long to wait.
 */
export async function countRequest(
  db: D1Database,
  key: string,
  { limit, windowMs }: Limit,
  now: number,
  message: (wait: string) => string,
) {
  const start = now - (now % windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, start)
    .first<{ count: number }>();
  if (row && row.count > limit) {
    const wait = start + windowMs - now;
    throw new HttpError(429, message(waitText(wait)), { "Retry-After": String(Math.ceil(wait / 1000)) });
  }
}
