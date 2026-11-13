import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { start } from "./harness.mjs";

const BAD_NAME = "Enter a name of up to 80 characters, or leave it empty.";

let w;
before(async () => {
  // The waitlist on, whatever is deployed, so a waiting account can be tried too.
  w = await start({ bindings: { ADMIN_EMAILS: "grace@example.com", SIGNUP_MODE: "waitlist" } });
});
after(() => w.stop());
beforeEach(() => w.reset());

/** Signs in with `name` sent along, as /signup does; returns the answer and the cookie. */
async function signUp(email, name) {
  const code = await w.codeFor(email);
  const verified = await w.call("/auth/verify", { body: { email, code, name } });
  return { ...verified, cookie: verified.headers.get("Set-Cookie")?.split(";")[0] };
}
const session = async (cookie) => (await w.call("/auth/session", { method: "GET", cookie })).body.user;
const stored = async (email) => (await w.db.prepare("SELECT name FROM users WHERE email = ?").bind(email).first())?.name;

describe("the name an account goes by", () => {
  test("is null until one is given", async () => {
    const cookie = await w.signIn("ada@example.com");
    assert.equal((await session(cookie)).name, null);
    assert.equal(await stored("ada@example.com"), null);
  });

  test("sign-up can give it, tidied", async () => {
    const { status, body, cookie } = await signUp("ada@example.com", "  Ada \t  Lovelace ");
    assert.equal(status, 200);
    assert.equal(body.user.name, "Ada Lovelace");
    assert.equal((await session(cookie)).name, "Ada Lovelace");
  });

  test("an empty name at sign-up is none", async () => {
    const { body } = await signUp("ada@example.com", "   ");
    assert.equal(body.user.name, null);
  });

  test("signing in again never replaces it, but fills it in if there is none", async () => {
    await signUp("ada@example.com", "Ada Lovelace");
    assert.equal((await signUp("ada@example.com", "Someone Else")).body.user.name, "Ada Lovelace");
    await w.signIn("bob@example.com");
    assert.equal((await signUp("bob@example.com", "Bob")).body.user.name, "Bob");
  });

  test("a name that can't be kept is refused before the code is tried", async () => {
    const code = await w.codeFor("ada@example.com");
    for (const name of ["x".repeat(81), "Ada\u0000", "Ada\nLovelace\u0007", "‮ecalevoL adA", 42, ["Ada"]]) {
      const refused = await w.call("/auth/verify", { body: { email: "ada@example.com", code, name } });
      assert.equal(refused.status, 400, JSON.stringify(name));
      assert.equal(refused.body.error, BAD_NAME);
    }
    // The code still has all its tries: refusing the name didn't use one.
    const { attempts } = await w.db.prepare("SELECT attempts FROM sign_in_codes WHERE email = ?").bind("ada@example.com").first();
    assert.equal(attempts, 0);
    assert.equal((await w.call("/auth/verify", { body: { email: "ada@example.com", code, name: "Ada" } })).status, 200);
  });

  test("80 characters fit, counted as characters, not bytes", async () => {
    const name = "é".repeat(40) + "李".repeat(39) + "😀";
    assert.equal([...name].length, 80);
    assert.equal((await signUp("ada@example.com", name)).body.user.name, name);
  });

  test("scripts that join with zero-width joiners keep them", async () => {
    // Malayalam, Hindi and emoji sequences use U+200C and U+200D inside a name.
    const name = "ന്‍ क्‌ष 👩‍💻";
    assert.ok(name.includes("‍") && name.includes("‌"));
    assert.equal((await signUp("ada@example.com", name)).body.user.name, name);
  });
});

describe("POST /auth/profile", () => {
  test("changes the signed-in account's name, and answers with the account", async () => {
    const cookie = await w.signIn("ada@example.com");
    const changed = await w.call("/auth/profile", { body: { name: " Ada  King " }, cookie });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body, { user: { email: "ada@example.com", name: "Ada King", waiting: true, admin: false } });
    assert.equal((await session(cookie)).name, "Ada King");
  });

  test("an empty name clears it", async () => {
    const { cookie } = await signUp("ada@example.com", "Ada");
    assert.equal((await w.call("/auth/profile", { body: { name: "" }, cookie })).body.user.name, null);
    assert.equal(await stored("ada@example.com"), null);
  });

  test("a waiting account can name itself too", async () => {
    const cookie = await w.signIn("ada@example.com");
    assert.equal((await session(cookie)).waiting, true);
    assert.equal((await w.call("/auth/profile", { body: { name: "Ada" }, cookie })).status, 200);
  });

  test("refuses a name that can't be kept, and changes nothing", async () => {
    const { cookie } = await signUp("ada@example.com", "Ada");
    const refused = await w.call("/auth/profile", { body: { name: "x".repeat(81) }, cookie });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, BAD_NAME);
    assert.equal(await stored("ada@example.com"), "Ada");
  });

  test("needs a session", async () => {
    const answer = await w.call("/auth/profile", { body: { name: "Ada" } });
    assert.equal(answer.status, 401);
    assert.equal(answer.body.error, "Sign in first.");
  });

  test("changes only its own account", async () => {
    const ada = await w.signIn("ada@example.com");
    await signUp("bob@example.com", "Bob");
    await w.call("/auth/profile", { body: { name: "Ada" }, cookie: ada });
    assert.equal(await stored("bob@example.com"), "Bob");
  });

  test("is refused from another site, before anything is read", async () => {
    const cookie = await w.signIn("ada@example.com");
    const foreign = await w.call("/auth/profile", { body: { name: "Mallory" }, cookie, origin: "https://evil.example" });
    assert.equal(foreign.status, 403);
    assert.equal(await stored("ada@example.com"), null);
  });

  test("the admin listing carries each account's name", async () => {
    await signUp("ada@example.com", "Ada Lovelace");
    await w.signIn("bob@example.com");
    const admin = await w.signIn("grace@example.com");
    const { users } = (await w.call("/admin/users", { method: "GET", cookie: admin })).body;
    assert.equal(users.find((u) => u.email === "ada@example.com").name, "Ada Lovelace");
    assert.equal(users.find((u) => u.email === "bob@example.com").name, null);
  });
});
