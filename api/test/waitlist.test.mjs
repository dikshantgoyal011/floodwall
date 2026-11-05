import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { SITE, start } from "./harness.mjs";

// Spaces and capitals on purpose: the list is normalized like any address.
const ADMINS = " Grace@Example.com , ops@example.com";
const GRACE = "grace@example.com";

const session = async (w, cookie) => (await w.call("/auth/session", { method: "GET", cookie })).body.user;
const status = async (w, email) =>
  (await w.db.prepare("SELECT status FROM users WHERE email = ?").bind(email).first())?.status;

describe("while sign-up is on the waitlist", () => {
  let w;
  before(async () => {
    w = await start({ bindings: { ADMIN_EMAILS: ADMINS } });
  });
  after(() => w.stop());
  beforeEach(() => w.reset());

  test("a new account signs in, but waits", async () => {
    const cookie = await w.signIn("ada@example.com");
    assert.deepEqual(await session(w, cookie), { email: "ada@example.com", waiting: true, admin: false });
    assert.equal(await status(w, "ada@example.com"), "waiting");
  });

  test("an admin never waits", async () => {
    const cookie = await w.signIn(GRACE);
    assert.deepEqual(await session(w, cookie), { email: GRACE, waiting: false, admin: true });
    assert.equal(await status(w, GRACE), "approved");
  });

  test("someone made an admin after joining the waitlist stops waiting", async () => {
    await w.db
      .prepare("INSERT INTO users (id, email, created_at, last_sign_in_at, status) VALUES ('u1', 'ops@example.com', 1, 1, 'waiting')")
      .run();
    const ops = await w.signIn("ops@example.com");
    assert.deepEqual(await session(w, ops), { email: "ops@example.com", waiting: false, admin: true });
    await w.signIn("ada@example.com");
    const listed = await w.call("/admin/users", { method: "GET", cookie: ops });
    assert.deepEqual(
      listed.body.users.map((u) => [u.email, u.status]),
      [
        ["ada@example.com", "waiting"],
        ["ops@example.com", "approved"],
      ],
    );
  });

  test("an admin lists every account, the waiting ones first", async () => {
    const admin = await w.signIn(GRACE);
    await w.signIn("ada@example.com");
    await w.signIn("bob@example.com");
    await w.signIn("cy@example.com");
    await w.db.prepare("UPDATE users SET status = 'approved' WHERE email = 'bob@example.com'").run();
    // Oldest first: grace, ada, bob, cy.
    for (const [i, email] of [GRACE, "ada@example.com", "bob@example.com", "cy@example.com"].entries()) {
      await w.db.prepare("UPDATE users SET created_at = ? WHERE email = ?").bind(1000 + i, email).run();
    }

    const listed = await w.call("/admin/users", { method: "GET", cookie: admin });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.signup, "waitlist");
    assert.deepEqual(
      listed.body.users.map((u) => [u.email, u.status, u.admin]),
      [
        ["cy@example.com", "waiting", false],
        ["ada@example.com", "waiting", false],
        ["bob@example.com", "approved", false],
        [GRACE, "approved", true],
      ],
    );
    const ada = listed.body.users[1];
    assert.equal(typeof ada.createdAt, "number");
    assert.equal(ada.approvedAt, null);
  });

  test("only an admin may use the admin calls", async () => {
    const ada = await w.signIn("ada@example.com");
    for (const [path, method, body] of [
      ["/admin/users", "GET"],
      ["/admin/approve", "POST", { email: "ada@example.com" }],
      ["/admin/remove", "POST", { email: "ada@example.com" }],
    ]) {
      const signedOut = await w.call(path, { method, body });
      assert.equal(signedOut.status, 401, path);
      assert.equal(signedOut.body.error, "Sign in first.");
      const notAdmin = await w.call(path, { method, body, cookie: ada });
      assert.equal(notAdmin.status, 403, path);
      assert.equal(notAdmin.body.error, "Only an admin can do that.");
    }
    assert.equal(await status(w, "ada@example.com"), "waiting");
  });

  test("approving lets the account in at once and emails its owner", async () => {
    const admin = await w.signIn(GRACE);
    const ada = await w.signIn("ada@example.com");
    w.outbox.length = 0;

    const approved = await w.call("/admin/approve", { body: { email: " Ada@Example.com " }, cookie: admin });
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.body, { approved: true, emailed: true });

    assert.deepEqual(await session(w, ada), { email: "ada@example.com", waiting: false, admin: false });
    const row = await w.db.prepare("SELECT status, approved_at, approved_by FROM users WHERE email = 'ada@example.com'").first();
    assert.equal(row.status, "approved");
    assert.equal(row.approved_by, GRACE);
    assert.equal(typeof row.approved_at, "number");

    assert.equal(w.outbox.length, 1);
    const [{ body }] = w.outbox;
    assert.deepEqual(body.to, ["ada@example.com"]);
    assert.equal(body.from, "Floodwall <notifications@floodwall.ai>");
    assert.equal(body.subject, "You're in: your Floodwall account is approved");
    assert.ok(body.text.includes(`${SITE}/app`));
    assert.ok(body.html.includes(`href="${SITE}/app"`));
  });

  test("the email links to the site the admin approved from", async () => {
    const admin = await w.signIn(GRACE, { origin: "https://floodwall.ai" });
    await w.signIn("ada@example.com");
    w.outbox.length = 0;
    await w.call("/admin/approve", { body: { email: "ada@example.com" }, cookie: admin, origin: "https://floodwall.ai" });
    assert.ok(w.outbox[0].body.text.includes("https://floodwall.ai/app"));
  });

  test("approving twice sends one email", async () => {
    const admin = await w.signIn(GRACE);
    await w.signIn("ada@example.com");
    w.outbox.length = 0;
    await w.call("/admin/approve", { body: { email: "ada@example.com" }, cookie: admin });
    const again = await w.call("/admin/approve", { body: { email: "ada@example.com" }, cookie: admin });
    assert.deepEqual(again.body, { approved: true, emailed: false });
    assert.equal(w.outbox.length, 1);
  });

  test("approving an address with no account, or no address, is refused", async () => {
    const admin = await w.signIn(GRACE);
    const missing = await w.call("/admin/approve", { body: { email: "nobody@example.com" }, cookie: admin });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "There is no account for that address.");
    const bad = await w.call("/admin/approve", { body: { email: "not an address" }, cookie: admin });
    assert.equal(bad.status, 400);
  });

  test("an approval stands when its email can't be sent", async () => {
    const failing = await start({
      bindings: { ADMIN_EMAILS: ADMINS },
      resend: ({ body }) => (body.subject.startsWith("You're in") ? new Response("down", { status: 500 }) : null),
    });
    try {
      const admin = await failing.signIn(GRACE);
      const ada = await failing.signIn("ada@example.com");
      const approved = await failing.call("/admin/approve", { body: { email: "ada@example.com" }, cookie: admin });
      assert.deepEqual(approved.body, { approved: true, emailed: false });
      assert.equal((await session(failing, ada)).waiting, false);
    } finally {
      await failing.stop();
    }
  });

  test("removing an account signs it out everywhere; signing in again puts it back on the waitlist", async () => {
    const admin = await w.signIn(GRACE);
    const ada = await w.signIn("ada@example.com");
    await w.call("/admin/approve", { body: { email: "ada@example.com" }, cookie: admin });

    const removed = await w.call("/admin/remove", { body: { email: "ada@example.com" }, cookie: admin });
    assert.equal(removed.status, 200);
    assert.equal(await session(w, ada), null);
    assert.equal(await status(w, "ada@example.com"), undefined);
    const left = await w.db.prepare("SELECT COUNT(*) AS n FROM sessions").first();
    assert.equal(left.n, 1, "only the admin's session is left");

    const again = await w.signIn("ada@example.com", { ip: "198.51.100.9" });
    assert.equal((await session(w, again)).waiting, true);
  });

  test("an admin can't be removed, and nor can an address with no account", async () => {
    const admin = await w.signIn(GRACE);
    const self = await w.call("/admin/remove", { body: { email: "OPS@example.com" }, cookie: admin });
    assert.equal(self.status, 400);
    assert.match(self.body.error, /ADMIN_EMAILS/);
    const missing = await w.call("/admin/remove", { body: { email: "nobody@example.com" }, cookie: admin });
    assert.equal(missing.status, 404);
  });

  test("admin calls from another site are refused, with an admin's cookie or not", async () => {
    const admin = await w.signIn(GRACE);
    await w.signIn("ada@example.com");
    const foreign = await w.call("/admin/approve", {
      body: { email: "ada@example.com" },
      cookie: admin,
      origin: "https://evil.example",
    });
    assert.equal(foreign.status, 403);
    const listed = await w.call("/admin/users", { method: "GET", cookie: admin, origin: "https://evil.example" });
    assert.equal(listed.headers.get("Access-Control-Allow-Origin"), null, "the page can't read the list");
    assert.equal(await status(w, "ada@example.com"), "waiting");
  });
});

describe("the SIGNUP_MODE flag", () => {
  test('"open" lets new accounts in, and the waitlist with them', async () => {
    const w = await start({ bindings: { ADMIN_EMAILS: ADMINS, SIGNUP_MODE: "open" } });
    try {
      // Someone who joined while the waitlist was on.
      await w.db
        .prepare("INSERT INTO users (id, email, created_at, last_sign_in_at, status) VALUES ('u1', 'old@example.com', 1, 1, 'waiting')")
        .run();
      const old = await w.signIn("old@example.com");
      assert.equal((await session(w, old)).waiting, false);

      const ada = await w.signIn("ada@example.com");
      assert.deepEqual(await session(w, ada), { email: "ada@example.com", waiting: false, admin: false });
      assert.equal(await status(w, "ada@example.com"), "approved");

      const admin = await w.signIn(GRACE);
      assert.equal((await w.call("/admin/users", { method: "GET", cookie: admin })).body.signup, "open");
    } finally {
      await w.stop();
    }
  });

  test("anything but \"open\" keeps the waitlist", async () => {
    for (const mode of ["waitlist", "Open", "", "yes"]) {
      const w = await start({ bindings: { SIGNUP_MODE: mode } });
      try {
        const cookie = await w.signIn("ada@example.com");
        assert.equal((await session(w, cookie)).waiting, true, JSON.stringify(mode));
      } finally {
        await w.stop();
      }
    }
  });

  test("the deployed setting is the waitlist", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.match(config, /"SIGNUP_MODE": "waitlist"/);
  });
});
