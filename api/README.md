# Sign-in service

A Cloudflare Worker, at `api.floodwall.ai`, behind the site's `/login`,
`/signup`, `/account`, `/waitlist` and `/app` pages. You sign in with a
six-digit code emailed through [Resend](https://resend.com). There is no
password, and the first sign-in with an address makes the account. During the
beta, new accounts wait for an admin to approve them.

The site uses the service when it is built with `VITE_AUTH_API_URL` set
(`site/.env.production`). Without it, the site runs the same flow as an
in-browser demo that shows the code on the page instead of emailing it.

## How it works

1. **Ask for a code.** The page sends the address. The service makes a random
   six-digit code, stores an HMAC of it (keyed with `AUTH_SECRET`), and emails
   the code. A new code replaces the last one.
2. **Check the code.** The page sends the address and the code. If it matches,
   the service deletes the code, makes the account if there isn't one yet, and
   starts a session.
3. **Stay signed in.** The session is a random token in a cookie that page
   scripts can't read. The service keeps only the token's SHA-256.
4. **Wait, during the beta.** While `SIGNUP_MODE` is `waitlist`, a new account
   is signed in but waiting: the site shows it `/waitlist` instead of the
   console. An admin approves it at `/app/admin`, which emails its owner
   "You're in", and the console opens for them from then on.

### The waitlist and the flag

`SIGNUP_MODE` in `wrangler.jsonc` decides who gets in:

| `SIGNUP_MODE` | A new account | Accounts already waiting |
|---|---|---|
| `waitlist` (deployed) | waits for an admin | wait for an admin |
| `open` | goes straight to the console | go straight to the console too |

Any value but `open` keeps the waitlist, so a typo can't open sign-up. To open
it once the beta is over, set `"SIGNUP_MODE": "open"` and deploy. Setting it
back to `waitlist` closes it again: approved accounts keep their access, and
accounts that joined while it was open stay approved.

The admins are the addresses in the `ADMIN_EMAILS` secret, comma-separated
(kept out of the repository). They never wait, and only they can use
`/app/admin`. On that page they can:

- **Approve** a waiting account. Its owner gets an email that links to the
  console on the site the admin approved from. If that email can't be sent,
  the approval still stands and the page says so.
- **Remove** an account. It is deleted and signed out everywhere; signing in
  again puts it back on the waitlist. Admins can't be removed there.

| Rule | |
|---|---|
| A code lasts | 10 minutes, and works once |
| Tries per code | 5; the fifth wrong one uses the code up |
| New codes | one a minute per address, 5 an hour, 20 a day |
| Per network (IP address) | 30 codes and 60 checks an hour |
| A session lasts | 30 days, or until you sign out |

With five tries a code and twenty codes a day, someone guessing another
person's code gets at most 100 tries a day out of a million codes, and that
person receives every one of those emails.

### What is stored

The D1 database `floodwall-auth` (schema in [`migrations/`](migrations)):

- `users`: the address, when the account was made, the latest sign-in, and
  whether it is `waiting` or `approved` (with when, and by which admin).
- `sign_in_codes`: one live code per address, as an HMAC, with its send time,
  expiry and tries.
- `sessions`: the SHA-256 of each session token, its account and its expiry.
- `rate_limits`: request counts per address and per network, per window.

A daily cron job deletes expired codes, expired sessions and counts from
ended windows. Accounts stay.

### Who may call it

- **Sites.** Only the origins in `ALLOWED_ORIGINS` can read the service's
  answers or send cookies with their requests. A POST from any other origin,
  or with none (`curl`, for one), is refused unread.
- **The cookie.** It's `__Host-floodwall_session`: `HttpOnly`, `Secure`,
  `SameSite=Strict`, host-only for `api.floodwall.ai`. Browsers count
  `floodwall.ai`, `preview.floodwall.ai` and `api.floodwall.ai` as one site,
  so the cookie goes with the site's requests and with nobody else's. Over
  plain HTTP, in local development, it's `floodwall_session` without
  `Secure`.

## API

Every answer is JSON. A refusal is `{ "error": "<a sentence for the reader>" }`,
which the site shows as it is.

| Request | Body | Answer |
|---|---|---|
| `POST /auth/code` | `{ "email": "ada@example.com" }` | `200 { "sent": true }`; `400` not an address; `429` too soon or too many, with `Retry-After`; `502` the email couldn't be sent |
| `POST /auth/verify` | `{ "email": "...", "code": "123456" }` | `200 { "user": <user> }` and the session cookie; `400` or `401` wrong or expired code; `429` too many checks |
| `GET /auth/session` | | `200 { "user": <user> }`, or `{ "user": null }` when signed out |
| `POST /auth/signout` | `{}` | `200 { "signedOut": true }`, and the cookie is cleared |
| `GET /admin/users` | | `200 { "signup": "waitlist" \| "open", "users": [...] }`, the waiting ones first; `401` signed out; `403` not an admin |
| `POST /admin/approve` | `{ "email": "..." }` | `200 { "approved": true, "emailed": true \| false }`; `404` no such account; `401`, `403` as above |
| `POST /admin/remove` | `{ "email": "..." }` | `200 { "removed": true }`; `400` an admin; `404` no such account; `401`, `403` as above |

`<user>` is `{ "email": "...", "waiting": false, "admin": false }`. `waiting` is
true while the account is on the waitlist; the site then shows `/waitlist`
instead of the console. Anything added to the service later that only
approved accounts may use should check `waiting` the same way.

Without `RESEND_API_KEY`, or an `AUTH_SECRET` of at least 32 characters,
`/auth/code` and `/auth/verify` answer `503`.

## Local development

```sh
cd api
npm ci
cp .dev.vars.example .dev.vars   # add a Resend key, an AUTH_SECRET and your address as an admin
npm run migrate:local
npm run dev                      # http://127.0.0.1:8787
```

Then point the site at it and start the site in another terminal:

```sh
echo VITE_AUTH_API_URL=http://127.0.0.1:8787 > site/.env.development.local
npm --prefix site run dev        # http://127.0.0.1:5173/login
```

The codes are real emails, so use an address you can read. Resend only
sends from a domain that's verified in the account the key belongs to.

## Tests

```sh
npm run check   # typecheck, bundle, then the tests
```

The tests run the bundle that `wrangler deploy` would upload in the Workers
runtime (Miniflare), with an empty D1 database and a stand-in for Resend that
keeps every email. They cover the whole flow and each rule above, including
requests that race each other, a Resend that refuses, a missing secret, the
cookie's attributes, origin checks, the daily sweep, the waitlist, the admin
calls and both settings of `SIGNUP_MODE`. CI runs them on every pull request.

## Deploying

Once, by someone with access to the Cloudflare account that has the
`floodwall.ai` zone:

1. **Sign in and make the database.**

   ```sh
   cd api
   npx wrangler login
   npx wrangler d1 create floodwall-auth
   ```

   Put the `database_id` it prints into `wrangler.jsonc`, then create the
   tables:

   ```sh
   npm run migrate:remote
   ```

2. **Add the secrets.** None goes in a file that is committed.

   ```sh
   npx wrangler secret put RESEND_API_KEY
   openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET
   npx wrangler secret put ADMIN_EMAILS     # e.g. you@deskera.com,teammate@deskera.com
   ```

3. **Check Resend.** `floodwall.ai` must show as verified in the Resend
   account that issued the key, since `MAIL_FROM`
   (`notifications@floodwall.ai`) is on it. It is: a real code was sent from
   it while building this. Its DNS records are `resend._domainkey` and
   `send.floodwall.ai`.

4. **Deploy.**

   ```sh
   npm run deploy
   ```

   The `api.floodwall.ai` custom domain in `wrangler.jsonc` makes the DNS
   record and the certificate.

5. **Switch the site over.** In `site/.env.production`, uncomment
   `VITE_AUTH_API_URL=https://api.floodwall.ai`, run
   `npm --prefix site run build` to rebuild `docs/`, and commit both. The
   preview workflow builds from the same file, so preview.floodwall.ai switches
   when that commit reaches `preview`.

6. **Try it.** Sign in at `https://preview.floodwall.ai/login` with an
   admin's address: the console opens, with Admin in the menu. Sign up with
   another address you can read: it lands on the waitlist and shows up at
   `/app/admin` to approve.

Later deploys are `npm run deploy`. To change who is an admin, run
`npx wrangler secret put ADMIN_EMAILS` again; it takes effect at once. To
change the schema, add a migration (`migrations/0003_….sql`) and run `npm run migrate:remote` before deploying
code that needs it. Changing `AUTH_SECRET` only invalidates codes sent in the
last ten minutes; sessions don't depend on it.
