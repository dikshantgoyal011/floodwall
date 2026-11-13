// JSON in and out, the sites allowed to call the service, and the session
// cookie.

import type { Env } from "./env";
import { MESSAGES } from "./rules";

/** A refusal the caller sees: its status and a sentence to show the reader. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

// An email address and a code fit many times over.
const MAX_BODY_LENGTH = 4096;

/**
 * The body as text, refused with a 413 once it passes MAX_BODY_LENGTH bytes. It's read a chunk at
 * a time, so a body sent without a Content-Length is stopped there rather than read in full.
 */
async function readBody(request: Request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_LENGTH) throw new HttpError(413, MESSAGES.badRequest);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_LENGTH);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > MAX_BODY_LENGTH) {
      await reader.cancel();
      throw new HttpError(413, MESSAGES.badRequest);
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}

/** The request's JSON object. Anything else is refused. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new HttpError(415, MESSAGES.badRequest);
  }
  const text = await readBody(request);
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Not JSON: refused below.
  }
  throw new HttpError(400, MESSAGES.badRequest);
}

/** The request's origin, if it is one of the sites allowed to call the service. */
export function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  return origin && allowed.includes(origin) ? origin : null;
}

/** Lets an allowed site read the response, cookies included. */
export function withCors(response: Response, origin: string | null) {
  const headers = new Headers(response.headers);
  headers.set("Vary", "Origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(response.body, { status: response.status, headers });
}

/** The answer to a browser asking whether a site may send JSON with cookies. */
export function preflight(origin: string | null) {
  if (!origin) return withCors(new Response(null, { status: 403 }), null);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "7200",
  };
  return withCors(new Response(null, { status: 204, headers }), origin);
}

// Over HTTPS the cookie takes the __Host- prefix, which browsers only accept
// with Secure, Path=/ and no Domain: it can't be set or read by any other
// host. Plain HTTP is local development.
function cookieName(url: URL) {
  return url.protocol === "https:" ? "__Host-floodwall_session" : "floodwall_session";
}

/** The session token the browser sent, if any. */
export function readSessionCookie(request: Request) {
  const name = cookieName(new URL(request.url));
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

/**
 * The Set-Cookie header for a session, or one that clears it. HttpOnly keeps
 * it from page scripts; SameSite=Strict keeps it to requests from the
 * site's own pages.
 */
export function sessionCookie(request: Request, token: string, maxAgeMs: number) {
  const url = new URL(request.url);
  const parts = [`${cookieName(url)}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}
