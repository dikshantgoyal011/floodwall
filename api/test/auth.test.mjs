import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { API, KEY, SECRET, SITE, start } from "./harness.mjs";

const WRONG = "That code is wrong or has expired. Check the newest code, or ask for a new one.";
const MINUTE = 60_000;
// A new account, as the service describes it while sign-up is on the waitlist.
const ADA = { user: { email: "ada@example.com", waiting: true, admin: false } };

let w;
before(async () => {
  w = await start();
});
after(() => w.stop());
beforeEach(() => w.reset());

/** The other of two six-digit codes. */
const other = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("signing in", () => {
  test("emails a code, and the code starts a session", async () => {
    const sent = await w.call("/auth/code", { body: { email: "ada@example.com" } });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { sent: true });

    assert.equal(w.outbox.length, 1);
    const [{ headers, body }] = w.outbox;
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.equal(body.from, "Floodwall <notifications@floodwall.ai>");
    assert.deepEqual(body.to, ["ada@example.com"]);
    const code = w.lastCode("ada@example.com");
    assert.match(code, /^\d{6}$/);
    assert.equal(body.subject, `${code} is your Floodwall sign-in code`);
    assert.ok(body.html.includes(`>${code}</p>`));
    assert.ok(body.text.includes("It expires in 10 minutes and works once."));

    const verified = await w.call("/auth/verify", { body: { email: "ada@example.com", code } });
    assert.equal(verified.status, 200);
    assert.deepEqual(verified.body, ADA);
    const cookie = verified.headers.get("Set-Cookie");
    assert.match(cookie, /^__Host-floodwall_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);

    const session = await w.call("/auth/session", { method: "GET", cookie: cookie.split(";")[0] });
    assert.deepEqual(session.body, ADA);
  });

  test("a first sign-in makes the account; later ones reuse it", async () => {
    await w.signIn("ada@example.com");
    const first = await w.db.prepare("SELECT id, created_at, last_sign_in_at FROM users").all();
    assert.equal(first.results.length, 1);

    await w.age("ada@example.com", MINUTE);
    await w.signIn("ada@example.com");
    const second = await w.db.prepare("SELECT id, created_at, last_sign_in_at FROM users").all();
    assert.equal(second.results.length, 1);
    assert.equal(second.results[0].id, first.results[0].id);
    assert.equal(second.results[0].created_at, first.results[0].created_at);
    assert.ok(second.results[0].last_sign_in_at >= first.results[0].last_sign_in_at);
    const sessions = await w.db.prepare("SELECT COUNT(*) AS n FROM sessions").first();
    assert.equal(sessions.n, 2, "each browser keeps its own session");
  });

  test("addresses are trimmed and lower-cased", async () => {
    const code = await w.codeFor("  Ada@Example.COM ");
    assert.deepEqual(w.outbox[0].body.to, ["ada@example.com"]);
    const verified = await w.call("/auth/verify", { body: { email: "ADA@example.com", code } });
    assert.deepEqual(verified.body, ADA);
  });

  test("refuses what isn't an address, and sends nothing", async () => {
    for (const email of ["", "ada", "ada@", "@example.com", "ada@example", "a da@example.com", "ada@exa\u0000mple.com", 42, null]) {
      const sent = await w.call("/auth/code", { body: { email } });
      assert.equal(sent.status, 400, String(email));
      assert.deepEqual(sent.body, { error: "Enter a valid email address." });
    }
    const long = `${"a".repeat(250)}@example.com`;
    assert.equal((await w.call("/auth/code", { body: { email: long } })).status, 400);
    assert.equal(w.outbox.length, 0);
  });

  test("refuses bodies that aren't a JSON object", async () => {
    const bad = { error: "That request could not be read." };
    const text = await w.mf.dispatchFetch(`${API}/auth/code`, {
      method: "POST",
      headers: { Origin: SITE, "Content-Type": "text/plain" },
      body: JSON.stringify({ email: "ada@example.com" }),
    });
    assert.equal(text.status, 415);
    assert.deepEqual(await text.json(), bad);
    for (const body of ["{", "[]", '"ada@example.com"', "null"]) {
      const sent = await w.call("/auth/code", { body });
      assert.equal(sent.status, 400, body);
      assert.deepEqual(sent.body, bad);
    }
    assert.equal((await w.call("/auth/code", { body: { email: "ada@example.com", pad: "x".repeat(5000) } })).status, 413);
    assert.equal(w.outbox.length, 0);
  });

  test("refuses a long body sent without a length", async () => {
    const body = JSON.stringify({ email: "ada@example.com", pad: "x".repeat(5000) });
    const streamed = await w.mf.dispatchFetch(`${API}/auth/code`, {
      method: "POST",
      headers: { Origin: SITE, "Content-Type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
      duplex: "half",
    });
    assert.equal(streamed.status, 413);
    assert.equal(w.outbox.length, 0);
  });

  test("codes are six digits, kept only as an HMAC", async () => {
    const codes = new Set();
    for (let i = 0; i < 40; i++) codes.add(await w.codeFor(`user${i}@example.com`, { ip: `198.51.100.${i}` }));
    assert.ok([...codes].every((c) => /^\d{6}$/.test(c)));
    assert.ok(codes.size >= 39, "codes are random");

    const { results } = await w.db.prepare("SELECT email, code_hash FROM sign_in_codes").all();
    for (const { email, code_hash } of results) {
      assert.match(code_hash, /^[0-9a-f]{64}$/);
      assert.ok(!code_hash.includes(w.lastCode(email)));
    }
  });

  test("sessions are kept as a hash of the cookie's token", async () => {
    const cookie = await w.signIn("ada@example.com");
    const token = cookie.split("=")[1];
    const { id } = await w.db.prepare("SELECT id FROM sessions").first();
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.notEqual(id, token);
  });
});

describe("checking a code", () => {
  test("a wrong code is refused", async () => {
    const code = await w.codeFor("ada@example.com");
    const checked = await w.call("/auth/verify", { body: { email: "ada@example.com", code: other(code) } });
    assert.equal(checked.status, 401);
    assert.deepEqual(checked.body, { error: WRONG });
    assert.equal(checked.headers.get("Set-Cookie"), null);
  });

  test("a code only works for the address it was sent to", async () => {
    const code = await w.codeFor("ada@example.com");
    await w.codeFor("bob@example.com");
    const checked = await w.call("/auth/verify", { body: { email: "bob@example.com", code } });
    assert.equal(checked.status, 401);
  });

  test("malformed codes are refused like wrong ones", async () => {
    await w.codeFor("ada@example.com");
    for (const code of ["", "12345", "1234567", "12 345", "abcdef", 123456, null]) {
      const checked = await w.call("/auth/verify", { body: { email: "ada@example.com", code } });
      assert.equal(checked.status, 400, String(code));
      assert.deepEqual(checked.body, { error: WRONG });
    }
  });

  test("the fifth try can still be right", async () => {
    const code = await w.codeFor("ada@example.com");
    for (let i = 0; i < 4; i++) {
      assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code: other(code) } })).status, 401);
    }
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 200);
  });

  test("five wrong tries use the code up", async () => {
    const code = await w.codeFor("ada@example.com");
    for (let i = 0; i < 5; i++) {
      assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code: other(code) } })).status, 401);
    }
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 401);
    assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM sign_in_codes").first()).n, 0);
  });

  test("a code expires after ten minutes", async () => {
    const code = await w.codeFor("ada@example.com");
    await w.age("ada@example.com", 10 * MINUTE);
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 401);
  });

  test("a code works once", async () => {
    const code = await w.codeFor("ada@example.com");
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 200);
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 401);
  });

  test("of two checks at once with the same code, one signs in", async () => {
    const code = await w.codeFor("ada@example.com");
    const checks = await Promise.all(
      Array.from({ length: 4 }, () => w.call("/auth/verify", { body: { email: "ada@example.com", code } })),
    );
    assert.deepEqual(checks.map((c) => c.status).sort(), [200, 401, 401, 401]);
    assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 1);
  });

  test("only the newest code works", async () => {
    const first = await w.codeFor("ada@example.com");
    await w.age("ada@example.com", MINUTE);
    const second = await w.codeFor("ada@example.com");
    if (first !== second) {
      assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code: first } })).status, 401);
    }
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code: second } })).status, 200);
  });

  test("a new code has five fresh tries", async () => {
    const first = await w.codeFor("ada@example.com");
    for (let i = 0; i < 4; i++) await w.call("/auth/verify", { body: { email: "ada@example.com", code: other(first) } });
    await w.age("ada@example.com", MINUTE);
    const second = await w.codeFor("ada@example.com");
    for (let i = 0; i < 4; i++) await w.call("/auth/verify", { body: { email: "ada@example.com", code: other(second) } });
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code: second } })).status, 200);
  });
});

describe("asking for codes", () => {
  test("one code a minute per address", async () => {
    await w.codeFor("ada@example.com");
    const again = await w.call("/auth/code", { body: { email: "ada@example.com" } });
    assert.equal(again.status, 429);
    assert.match(again.body.error, /^You can ask for a new code in (60|59) s\.$/);
    assert.match(again.headers.get("Retry-After"), /^(60|59)$/);
    assert.equal(w.outbox.length, 1);

    await w.age("ada@example.com", 45_000);
    assert.match((await w.call("/auth/code", { body: { email: "ada@example.com" } })).body.error, /in 1[45] s\./);
    await w.age("ada@example.com", 15_000);
    assert.equal((await w.call("/auth/code", { body: { email: "ada@example.com" } })).status, 200);
    assert.equal(w.outbox.length, 2);
  });

  test("of several asks at once, one sends a code", async () => {
    const asks = await Promise.all(
      Array.from({ length: 5 }, () => w.call("/auth/code", { body: { email: "ada@example.com" } })),
    );
    assert.deepEqual(asks.map((a) => a.status).sort(), [200, 429, 429, 429, 429]);
    assert.equal(w.outbox.length, 1);
    // The one code saved is the one emailed.
    const code = w.lastCode("ada@example.com");
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 200);
  });

  test("five codes an hour per address", async () => {
    for (let i = 0; i < 5; i++) {
      await w.codeFor("ada@example.com");
      await w.age("ada@example.com", MINUTE);
    }
    const sixth = await w.call("/auth/code", { body: { email: "ada@example.com" } });
    assert.equal(sixth.status, 429);
    assert.match(sixth.body.error, /^Too many codes were sent to this address\. Try again in (\d+ minutes|1 minute)\.$/);
    assert.equal(w.outbox.length, 5);
    // Another address is not held up.
    await w.codeFor("bob@example.com");
  });

  test("twenty codes a day per address", async () => {
    const day = 24 * 60 * MINUTE;
    const start = Date.now() - (Date.now() % day);
    await w.db
      .prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 20)")
      .bind("code:address-day:ada@example.com", start)
      .run();
    const asked = await w.call("/auth/code", { body: { email: "ada@example.com" } });
    assert.equal(asked.status, 429);
    assert.match(asked.body.error, /^Too many codes were sent to this address\. Try again in \d+ (hours|minutes?)\.$/);
    assert.equal(w.outbox.length, 0);
  });

  test("thirty codes an hour per network", async () => {
    for (let i = 0; i < 30; i++) await w.codeFor(`user${i}@example.com`);
    const asked = await w.call("/auth/code", { body: { email: "ada@example.com" } });
    assert.equal(asked.status, 429);
    assert.match(asked.body.error, /^Too many sign-in attempts from this network\. Try again in/);
    assert.ok(Number(asked.headers.get("Retry-After")) > 0);
    // Another network is not held up.
    await w.codeFor("ada@example.com", { ip: "198.51.100.1" });
  });

  test("sixty checks an hour per network", async () => {
    const code = await w.codeFor("ada@example.com");
    const wrong = other(code);
    for (let i = 0; i < 60; i++) await w.call("/auth/verify", { body: { email: `user${i}@example.com`, code: wrong } });
    const checked = await w.call("/auth/verify", { body: { email: "ada@example.com", code } });
    assert.equal(checked.status, 429);
    assert.match(checked.body.error, /^Too many sign-in attempts from this network\./);
    // The right code still works from elsewhere: the refusal used none of its tries.
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code }, ip: "198.51.100.1" })).status, 200);
  });

  test("if Resend refuses, the reader can try again at once", async () => {
    let refuse = true;
    const failing = await start({
      resend: () => (refuse ? Response.json({ name: "validation_error", message: "domain not verified" }, { status: 403 }) : null),
    });
    try {
      const sent = await failing.call("/auth/code", { body: { email: "ada@example.com" } });
      assert.equal(sent.status, 502);
      assert.deepEqual(sent.body, { error: "We could not send the email. Please try again in a moment." });
      assert.equal((await failing.db.prepare("SELECT COUNT(*) AS n FROM sign_in_codes").first()).n, 0);

      refuse = false;
      const code = await failing.codeFor("ada@example.com");
      assert.equal((await failing.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 200);
    } finally {
      await failing.stop();
    }
  });

  test("if Resend fails, the same", async () => {
    const down = await start({ resend: () => new Response("upstream timeout", { status: 504 }) });
    try {
      const sent = await down.call("/auth/code", { body: { email: "ada@example.com" } });
      assert.equal(sent.status, 502);
      assert.equal((await down.db.prepare("SELECT COUNT(*) AS n FROM sign_in_codes").first()).n, 0);
    } finally {
      await down.stop();
    }
  });
});

describe("sessions", () => {
  test("no cookie, or a made-up one, is signed out", async () => {
    assert.deepEqual((await w.call("/auth/session", { method: "GET" })).body, { user: null });
    for (const cookie of ["__Host-floodwall_session=nope", `__Host-floodwall_session=${"a".repeat(43)}`]) {
      assert.deepEqual((await w.call("/auth/session", { method: "GET", cookie })).body, { user: null });
    }
  });

  test("signing out ends the session for good", async () => {
    const cookie = await w.signIn("ada@example.com");
    const out = await w.call("/auth/signout", { body: {}, cookie });
    assert.equal(out.status, 200);
    assert.equal(
      out.headers.get("Set-Cookie"),
      "__Host-floodwall_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
    );
    assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 0);
    // Even a copy of the old cookie no longer works.
    assert.deepEqual((await w.call("/auth/session", { method: "GET", cookie })).body, { user: null });
  });

  test("signing out ends only that browser's session", async () => {
    const one = await w.signIn("ada@example.com");
    await w.age("ada@example.com", MINUTE);
    const two = await w.signIn("ada@example.com");
    await w.call("/auth/signout", { body: {}, cookie: one });
    assert.deepEqual((await w.call("/auth/session", { method: "GET", cookie: two })).body, ADA);
  });

  test("a session lasts 30 days", async () => {
    const cookie = await w.signIn("ada@example.com");
    const { expires_at, created_at } = await w.db.prepare("SELECT expires_at, created_at FROM sessions").first();
    assert.equal(expires_at - created_at, 30 * 24 * 60 * MINUTE);
    await w.db.prepare("UPDATE sessions SET expires_at = ?").bind(Date.now() - 1).run();
    assert.deepEqual((await w.call("/auth/session", { method: "GET", cookie })).body, { user: null });
  });

  test("over plain HTTP (local development) the cookie has no prefix and no Secure", async () => {
    const base = "http://127.0.0.1:8787";
    const code = await w.codeFor("ada@example.com", { base });
    const verified = await w.call("/auth/verify", { body: { email: "ada@example.com", code }, base });
    const cookie = verified.headers.get("Set-Cookie");
    assert.match(cookie, /^floodwall_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
    const session = await w.call("/auth/session", { method: "GET", cookie: cookie.split(";")[0], base });
    assert.deepEqual(session.body, ADA);
  });
});

describe("who may call", () => {
  test("allowed sites can read answers, cookies included", async () => {
    for (const origin of ["https://floodwall.ai", "https://preview.floodwall.ai"]) {
      const sent = await w.call("/auth/code", { body: { email: `ada@${origin.slice(8)}` }, origin });
      assert.equal(sent.status, 200);
      assert.equal(sent.headers.get("Access-Control-Allow-Origin"), origin);
      assert.equal(sent.headers.get("Access-Control-Allow-Credentials"), "true");
      assert.equal(sent.headers.get("Vary"), "Origin");
      assert.equal(sent.headers.get("Cache-Control"), "no-store");
    }
  });

  test("the preflight answers allowed sites only", async () => {
    const ask = (origin) =>
      w.mf.dispatchFetch(`${API}/auth/verify`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      });
    const allowed = await ask(SITE);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), SITE);
    assert.equal(allowed.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "GET, POST");
    assert.equal(allowed.headers.get("Access-Control-Allow-Headers"), "Content-Type");

    const refused = await ask("https://evil.example");
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get("Access-Control-Allow-Origin"), null);
  });

  test("a POST from another site, or from no site, is refused unread", async () => {
    const cookie = await w.signIn("ada@example.com");
    for (const origin of ["https://evil.example", "https://floodwall.ai.evil.example", "null", undefined]) {
      for (const [path, body] of [
        ["/auth/code", { email: "bob@example.com" }],
        ["/auth/verify", { email: "bob@example.com", code: "123456" }],
        ["/auth/signout", {}],
      ]) {
        const refused = await w.call(path, { body, cookie, origin: origin ?? null });
        assert.equal(refused.status, 403, `${origin} ${path}`);
        assert.deepEqual(refused.body, { error: "This site cannot use Floodwall sign-in." });
        assert.equal(refused.headers.get("Access-Control-Allow-Origin"), null);
      }
    }
    assert.equal(w.outbox.filter((e) => e.body.to[0] === "bob@example.com").length, 0);
    // The session survived the foreign sign-out.
    assert.deepEqual((await w.call("/auth/session", { method: "GET", cookie })).body, ADA);
  });

  test("another site's page can't read who is signed in", async () => {
    const cookie = await w.signIn("ada@example.com");
    const read = await w.call("/auth/session", { method: "GET", cookie, origin: "https://evil.example" });
    assert.equal(read.headers.get("Access-Control-Allow-Origin"), null);
  });

  test("anything else is not found", async () => {
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/auth/code"],
      ["POST", "/auth/session"],
      ["POST", "/auth/codes"],
      ["DELETE", "/auth/session"],
    ]) {
      const answer = await w.call(path, { method, body: method === "POST" ? {} : undefined });
      assert.equal(answer.status, 404, `${method} ${path}`);
      assert.deepEqual(answer.body, { error: "Not found." });
    }
  });
});

describe("configuration", () => {
  test("without its secrets, sign-in says it is unavailable", async () => {
    for (const bindings of [{ RESEND_API_KEY: "" }, { AUTH_SECRET: "" }, { AUTH_SECRET: "too-short" }]) {
      const bare = await start({ bindings });
      try {
        for (const [path, body] of [
          ["/auth/code", { email: "ada@example.com" }],
          ["/auth/verify", { email: "ada@example.com", code: "123456" }],
        ]) {
          const answer = await bare.call(path, { body });
          assert.equal(answer.status, 503, JSON.stringify(bindings));
          assert.deepEqual(answer.body, { error: "Sign-in is not available right now. Please try again later." });
        }
        assert.equal(bare.outbox.length, 0);
      } finally {
        await bare.stop();
      }
    }
  });

  test("a stored code is bound to its address", async () => {
    // Copying one address's stored code to another doesn't let its code in there.
    const code = await w.codeFor("ada@example.com");
    const { code_hash } = await w.db.prepare("SELECT code_hash FROM sign_in_codes WHERE email = 'ada@example.com'").first();
    await w.db
      .prepare("INSERT INTO sign_in_codes (email, code_hash, sent_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind("bob@example.com", code_hash, Date.now(), Date.now() + 10 * MINUTE)
      .run();
    assert.equal((await w.call("/auth/verify", { body: { email: "bob@example.com", code } })).status, 401);
  });

  test("codes from one secret don't check under another", async () => {
    const code = await w.codeFor("ada@example.com");
    const { code_hash } = await w.db.prepare("SELECT code_hash FROM sign_in_codes").first();
    const other = await start({ bindings: { AUTH_SECRET: `${SECRET}-rotated` } });
    try {
      await other.db
        .prepare("INSERT INTO sign_in_codes (email, code_hash, sent_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind("ada@example.com", code_hash, Date.now(), Date.now() + 10 * MINUTE)
        .run();
      assert.equal((await other.call("/auth/verify", { body: { email: "ada@example.com", code } })).status, 401);
    } finally {
      await other.stop();
    }
  });
});

describe("the daily sweep", () => {
  test("deletes expired codes, sessions and ended counts, and nothing else", async () => {
    const now = Date.now();
    const day = 24 * 60 * MINUTE;
    await w.signIn("old@example.com");
    await w.signIn("new@example.com");
    await w.codeFor("stale@example.com");
    await w.codeFor("fresh@example.com");
    await w.age("stale@example.com", 10 * MINUTE);
    await w.db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'old@example.com')").bind(now - 1).run();
    await w.db.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES ('old', ?, 1)").bind(now - 2 * day).run();

    const worker = await w.mf.getWorker();
    await worker.scheduled({ cron: "17 3 * * *" });

    const codes = await w.db.prepare("SELECT email FROM sign_in_codes").all();
    assert.deepEqual(codes.results.map((r) => r.email), ["fresh@example.com"]);
    const sessions = await w.db.prepare("SELECT users.email FROM sessions JOIN users ON users.id = sessions.user_id").all();
    assert.deepEqual(sessions.results.map((r) => r.email), ["new@example.com"]);
    const counts = await w.db.prepare("SELECT key FROM rate_limits WHERE key = 'old'").all();
    assert.equal(counts.results.length, 0);
    assert.ok((await w.db.prepare("SELECT COUNT(*) AS n FROM rate_limits").first()).n > 0, "current counts stay");
    const users = await w.db.prepare("SELECT email FROM users ORDER BY email").all();
    assert.deepEqual(users.results.map((r) => r.email), ["new@example.com", "old@example.com"], "accounts stay");
  });
});
