// Runs the built Worker (dist/index.js, from `npm run build`) in Miniflare,
// with an empty D1 database and a stand-in for Resend that keeps every email
// it is sent.

import fs from "node:fs";
import path from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""),
);

export const API = "https://api.floodwall.ai";
export const SITE = "https://preview.floodwall.ai";
export const SECRET = "test-secret-that-is-at-least-32-characters";
export const KEY = "re_test_key";

/** Starts the Worker. `resend(request)` can stand in for Resend's answer. */
export async function start({ bindings = {}, resend } = {}) {
  const outbox = [];
  // Wrangler's Miniflare 5 still reads the familiar version 4 options.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      // Module names are relative to this; the default, the working directory,
      // breaks when the tests run from anywhere but api/.
      modulesRoot: path.join(root, "dist"),
      scriptPath: path.join(root, "dist/index.js"),
      compatibilityDate: config.compatibility_date,
      d1Databases: { DB: "floodwall-auth-test" },
      bindings: { ...config.vars, RESEND_API_KEY: KEY, AUTH_SECRET: SECRET, ...bindings },
      async outboundService(request) {
        if (request.url !== "https://api.resend.com/emails") return new Response("unexpected fetch", { status: 599 });
        const email = { headers: Object.fromEntries(request.headers), body: await request.json() };
        const answer = resend ? await resend(email) : null;
        if (answer) return answer;
        outbox.push(email);
        return Response.json({ id: `email-${outbox.length}` });
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of fs.readdirSync(path.join(root, config.d1_databases[0].migrations_dir)).sort()) {
    const sql = fs.readFileSync(path.join(root, "migrations", file), "utf8").replace(/^--.*$/gm, "");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }

  /** A request as the site would send it: JSON, from SITE, from one network. */
  async function call(pathname, { method = "POST", body, cookie, origin = SITE, ip = "203.0.113.7", base = API } = {}) {
    const headers = { "CF-Connecting-IP": ip };
    if (origin) headers.Origin = origin;
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await mf.dispatchFetch(`${base}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  /** The code in the last email sent to `to`. */
  function lastCode(to) {
    const email = outbox.findLast((e) => e.body.to[0] === to);
    return email?.body.text.match(/^\d{6}$/m)?.[0];
  }

  /** Asks for a code and returns it, as read from the email. */
  async function codeFor(email, options = {}) {
    const sent = await call("/auth/code", { body: { email }, ...options });
    if (sent.status !== 200) throw new Error(`code not sent: ${sent.status} ${JSON.stringify(sent.body)}`);
    return lastCode(email.trim().toLowerCase());
  }

  /** Signs in and returns the cookie to send back. */
  async function signIn(email, options = {}) {
    const code = await codeFor(email, options);
    const verified = await call("/auth/verify", { body: { email, code }, ...options });
    if (verified.status !== 200) throw new Error(`not signed in: ${verified.status}`);
    return verified.headers.get("Set-Cookie").split(";")[0];
  }

  /** Moves an address's code back in time, as if it was sent `ms` earlier. */
  async function age(email, ms) {
    await db
      .prepare("UPDATE sign_in_codes SET sent_at = sent_at - ?1, expires_at = expires_at - ?1 WHERE email = ?2")
      .bind(ms, email)
      .run();
  }

  async function reset() {
    outbox.length = 0;
    for (const table of ["sessions", "users", "sign_in_codes", "rate_limits"]) {
      await db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  return { mf, db, outbox, call, lastCode, codeFor, signIn, age, reset, stop: () => mf.dispose() };
}
