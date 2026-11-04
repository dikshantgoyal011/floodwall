// Codes, session tokens and the hashes that are stored in their place.

import { CODE_LENGTH } from "./rules";

const encoder = new TextEncoder();
const CODES = 10 ** CODE_LENGTH;
// The largest multiple of CODES a Uint32 can hold: drawing below it keeps
// every code equally likely.
const FAIR_LIMIT = Math.floor(2 ** 32 / CODES) * CODES;

/** A random six-digit code, leading zeros kept. */
export function newCode() {
  const draw = new Uint32Array(1);
  do crypto.getRandomValues(draw);
  while (draw[0] >= FAIR_LIMIT);
  return String(draw[0] % CODES).padStart(CODE_LENGTH, "0");
}

/** 32 random bytes, base64url: the session cookie's value. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether a cookie value has the shape newToken() gives. */
export function isToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The SHA-256 of a session token: what the sessions table keeps. */
export async function tokenHash(token: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

/**
 * HMAC-SHA256 of the address and code under AUTH_SECRET. There are only a
 * million codes, so a plain hash could be reversed by trying them all; the
 * secret means a copy of the database alone is not enough.
 */
export async function codeHash(secret: string, email: string, code: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${email}\n${code}`)));
}

/** Compares two hashes in time that does not depend on where they differ. */
export function sameHash(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}
