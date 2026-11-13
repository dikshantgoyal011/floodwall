# GOALS - floodwall

Sequenced milestones toward a control plane that makes high-volume,
agent-driven DevOps survivable. The throughline: agents generate change
faster than humans can review, so the system has to govern *throughput*,
not approve line items.

Every task has a stable `FW-` id so it can be referenced from issues, PRs,
and [STATUS.md](STATUS.md). Items marked *(new)* were added after v0.1
shipped, from a review of the v0.1 code and site.

## v0.1 - the wall ✦ **shipped**

- `Intent` model: attributed change with `Action`, `Priority`, `BlastRadius`.
- `Admission`: per-agent token-bucket rate limiting + bounded priority queue
  with backpressure. Logical-clock time, fully deterministic.
- `policy` + `Gate`: `Policy` trait, three reference policies
  (`NoGlobalDestroy`, `BlastNeedsPriority`, `ResourceAllowlist`), composed
  deny-overrides with a full per-policy breakdown.
- `Ledger`: append-only FNV-1a hash chain, `verify()` detects any edit.
- `Floodwall`: submit -> admit -> gate -> record end to end.
- Demo binary flooding the wall with 4000 intents across five agents.
- Tests: 20 unit + 1 doctest. fmt + clippy (`-D warnings`) clean.

## v0.1.x - hardening *(new)* ✦ **done**

Small fixes found reviewing v0.1. None change the public model.

- **FW-101** ✓ Ship `robots.txt` and `sitemap.xml` to floodwall.ai: they
  were added to `site/public/` but `docs/` was never rebuilt.
- **FW-102** ✓ CI check that fails when `docs/` is out of date with a fresh
  `site/` build, so the published site cannot drift from its source again.
  `.gitattributes` keeps `site/` and `docs/` LF so Windows builds match.
- **FW-103** ✓ Validate `RateLimit`: a `burst` below `1.0` means the bucket
  can never hold a whole token, so every intent from every agent is
  silently rate-limited. Non-finite, negative, or sub-1 bursts are refused
  up front (`RateLimit::try_new`).
- **FW-104** ✓ Bound the per-agent bucket map: a fleet that minted fresh
  agent ids grew memory without limit. A bucket that has refilled to
  `burst` is identical to a new one, so it is forgotten; pruning runs as
  the map grows and never changes a decision, because `Admission` time
  never moves backwards. Exception: with `refill_per_tick == 0` a spent
  bucket never refills and is kept, since that limit is a lifetime quota.
- **FW-105** ✓ Ledger records carry the evidence: the verdict reason, the
  per-policy breakdown, and a summary of the action.
- **FW-106** ✓ The site's hero stats (version, dependency and test counts)
  are read from the crate at build time instead of hard-coded. The test
  count is source-counted: `#[test]` functions and doc examples under
  `src/`.

## v0.2 - scheduler ✦ **done**

A scheduler between admission and the gate decides when each intent may
start; admitted intents are in flight until the caller reports back.
Deferred intents are held for a human instead of dropped. Checked by
`tests/scheduler_invariants.rs` (300 seeded random floods against an
independent model).

- **FW-201** ✓ Scheduler stage between admission and the gate.
  `Floodwall::tick(now)` is one pass over the queue; admitted intents are
  in flight until `Floodwall::complete(key, outcome, now)`.
- **FW-202** ✓ Wide-blast serialization: a `Global` intent runs alone,
  `Region` intents run one at a time with their resource to themselves,
  and a blocked wide intent cannot be overtaken by lower-priority work.
- **FW-203** ✓ Narrow intents run concurrently, one lane per resource.
- **FW-204** ✓ Conflict detection on `(resource, action)`: another agent's
  contradictory change within the conflict window is deferred.
- **FW-205** ✓ Per-resource in-flight limits (default and per resource).
- **FW-206** ✓ Hold queue: deferred intents wait for a human to release
  (deferrals waived, rejections still apply) or expire them, with an
  optional TTL and a capacity.
- **FW-207** ✓ Demo, README (examples compiled as doctests), and site
  updated for the scheduler.

## v0.3 - trustworthy ledger ✦ **done**

- **FW-301** ✓ Replace FNV-1a with a SHA-256 chain (reuse the from-scratch
  primitive from `shunya`). The record encoding is documented in
  `src/ledger.rs` and pinned by digests from an independent implementation.
- **FW-302** ✓ Per-record signatures keyed by agent identity. Agents sign
  intents with Ed25519 (with SHA-512, from scratch); the plane checks them
  against a keyring at submit, and every record carries the signature so
  `Ledger::verify_signatures` proves authorship with public keys alone.
- **FW-303** ✓ Periodic Merkle checkpoints so a verifier can audit a suffix
  without replaying from genesis. RFC 6962 Merkle tree over record digests;
  checkpoints (head, root, frontier) cut every N records and optionally
  signed by the plane; `audit_suffix` checks the records after a trusted
  checkpoint alone; `Ledger::prove_inclusion` gives O(log n) inclusion
  proofs.
- **FW-304** ✓ *(new)* A plain export format (JSON Lines) so auditors can
  verify the chain with their own tooling. `Ledger::export_jsonl` and
  `export_jsonl_from(checkpoint)`; `tools/verify-ledger.mjs` verifies
  exports with only Node's standard library, in CI.

## v0.4 - persistence + replay ✦ **done**

- **FW-401** ✓ Durable, append-only ledger on disk. `Ledger::create` and
  `Ledger::open` keep the ledger in a file that is its JSON Lines export,
  synced before any decision is reported; opening locks the file, checks
  it from genesis, and recovers from a crash mid-write.
- **FW-402** ✓ Rebuild full plane state (buckets, queue watermarks) from the
  ledger on restart. `Floodwall::resume` replays the ledger on a newly
  built plane and checks every record comes out the same; every intent
  that gets into the queue is recorded (`queued`).
- **FW-403** ✓ Property test: replay(record-stream) reproduces the live
  decisions. `tests/replay_property.rs`: random floods, replayed whole and
  restarted at random points (from exports, from files, and after crashes
  that cut a tick short), and a changed decision caught at its record.
- **FW-404** ✓ *(new)* Record the tick on every ledger record. Conflict
  windows and hold TTLs depend on time, so replay needs it. `Record::tick`,
  record encoding v3, and a ledger clock that never goes back.
- **FW-405** ✓ *(new)* Rebuild scheduler and hold state (in-flight intents,
  conflict claims, held intents, pending releases) from the ledger, not
  just admission state. Delivered with FW-402: the replay rebuilds all of
  it.

## v0.5 - policy as code ✦ **done**

- **FW-501** ✓ Declarative policy format so rules are data, not Rust.
  `floodwall::rules`: a small rules language (`reject`/`defer` "reason"
  `when` condition), type-checked when read, and `Gate::with_rules`;
  `policies/standard.rules` writes the built-in policies in it.
- **FW-502** ✓ A worked OPA/Rego-style example evaluated at the gate.
  `policies/production.rules`: production guardrails written as rules,
  each next to its Rego in `policies/README.md`, run at the gate by
  `cargo run --example production`, and checked against a transcription
  of the Rego on every combination of what they test.
- **FW-503** ✓ Policy bundles versioned and recorded in the ledger alongside
  verdicts. A rules file declares `bundle "<name>" revision "<revision>"`;
  every decision made with it records the name, the revision and the
  file's SHA-256, covered by the record's digest (record encoding v4).

## Accounts, sign-in and billing *(new)*

The site has email sign-in, a waitlist and a pricing page (on
preview.floodwall.ai). These tasks make sign-in visible across the site,
open sign-up, and start taking payments. Each task gives its size (S, M, L)
and when to pick it up (now, next, later).

- **FW-601** Show sign-in state in the site header *(M, now)*. Signed out,
  the landing and pricing pages show **Sign in** and **Get started**.
  Signed in, they show the person's name and initials, with a menu
  (Account, Console, Sign out). The landing page is prerendered, so the
  header asks for the session after the page loads, holding its space so
  nothing jumps and never briefly showing the wrong state.
- **FW-602** A profile name *(S–M, now)*. Accounts store only an email. Add
  a name (and optionally a company), ask for it at sign-up or first sign-in,
  and let people edit it on `/account`. The header shows it (FW-601),
  falling back to the email.
- **FW-603** Open sign-up, skipping the waitlist *(S, now)*. Set
  `SIGNUP_MODE` to `"open"` and redeploy the Worker. Change "Join the
  waitlist" to "Get started free", the header's Waitlist link to Sign up,
  and the `/signup` copy back from the waitlist wording. The admin page
  stays as a list of users.
- **FW-604** Bot protection on sign-up *(S, now, with FW-603)*. Cloudflare
  Turnstile on the sign-up and sign-in forms, so open sign-up can't be
  scripted to use up the Resend email quota. Needs a CSP update.
- **FW-605** Terms, Privacy and Refund pages *(S, now)*. `/signup` already
  says signing up accepts the terms, but the pages don't exist, and payment
  providers require them. The wording comes from legal.
- **FW-606** Choose a payment provider *(decision, now)*. Stripe, or a
  merchant of record (Paddle, Lemon Squeezy) that handles VAT and GST
  worldwide. Depends on the company's entity and country.
- **FW-607** Plans and checkout *(M–L, next; needs FW-605 and FW-606)*.
  Every account starts on Free. Upgrading on `/pricing` opens checkout for
  Launch or Scale; the provider's webhooks tell the Worker, which stores the
  plan in D1. `/account` gets a Billing section: plan, invoices, and the
  provider's portal to change the card or cancel.
- **FW-608** Account controls *(M, next)*. See signed-in devices, sign out
  everywhere, change email, and delete the account (needed for privacy
  law).
- **FW-609** Sign in with GitHub and Google *(M, next)*.
- **FW-610** A welcome email on first sign-up *(S, next)*.

## Floodwall Cloud *(new)*

The console runs an example plane in the browser, so nothing real makes
decisions yet. Pricing charges per 1,000 decisions, so usage billing needs
a hosted plane.

- **FW-701** A hosted plane per account *(L, later)*. Run the crate itself
  on Cloudflare, compiled to WebAssembly (it has no dependencies), with one
  plane per account, and back the console with it instead of example data.
- **FW-702** API keys *(M, later, with FW-701)*. Create and revoke keys so
  agents can send intents to their hosted plane.
- **FW-703** Usage dashboard *(S–M, later, after FW-701)*. Decisions this
  month, by agent, from the plane's stats (FW-904).
- **FW-704** Usage-based billing *(L, later; needs FW-607 and FW-701)*.
  Report decisions to the payment provider, show them on `/account`, and
  enforce the Free plan's limits.
- **FW-705** Teams and roles *(M–L, later)*. Invite teammates as owner,
  operator or viewer. Releases and expiries are then recorded under the
  signed-in operator (FW-907).
- **FW-706** Alerts for held intents *(M, later)*. Email or Slack when an
  intent is waiting for a human to release it.

## Site and operations *(new)*

- **FW-801** Error alerts for the Worker and site *(S, next)*. Today a
  failure shows up only in the Worker's logs.
- **FW-802** Privacy-friendly analytics *(S, next)*. Cloudflare Web
  Analytics for sign-ups and pricing-page conversion. Needs a CSP update.
- **FW-803** Docs and a quickstart *(M, next)*. How to run the crate and
  connect an agent.
- **FW-804** Plan the release from preview to floodwall.ai *(decision,
  now)*. floodwall.ai has no sign-in yet, so none of the above reaches the
  public site until preview is merged to `main`.

## Later

- **FW-901** Backpressure signalling back to agents (a credit/quota
  protocol) so a well-behaved fleet self-throttles before it hits the wall.
- **FW-902** Distributed floodwall: shard by resource, gossip the ledger
  heads.
- **FW-903** Formal model (TLA+) of the admit/serialize/commit protocol with
  safety (no two conflicting changes commit) and liveness (every admitted
  intent eventually decides) obligations.
- **FW-904** ✓ *(new)* Observability: per-agent admit / defer / reject
  counters, queue depth, and rate-limit hits, exposed without adding a
  runtime dependency. `Floodwall::stats` counts, per agent and in all,
  every refusal at the door by its reason and every decision, release,
  expiry and outcome, with the queue's depth and peak, what is in flight
  and what is held; `Stats::prometheus` writes them in the Prometheus text
  format.
- **FW-905** *(new)* Throughput benchmarks for admission and the gate, so
  the scheduler and SHA-256 work can be measured against v0.1.
- **FW-906** ✓ *(new)* Optional in-flight leases: surface (or auto-fail)
  intents in flight longer than a configured number of ticks. Without one,
  an intent the caller never completes holds its resource forever.
  `SchedulerConfig::with_lease`: under `Lease::Report(n)`, every tick
  reports what has been in flight for `n` ticks or more
  (`TickReport::overdue`); under `Lease::Fail(n)`, the tick records it
  `lapsed` and frees its place for that same pass (`TickReport::lapsed`).
- **FW-907** *(new)* Authenticated release and expiry. `by` is a free-text
  name recorded in the ledger; tie it to a verified operator identity
  (and sign it once records are signed, FW-302).
- **FW-908** ✓ *(new)* Optional aging for low-priority work. Priority is
  strict, so a steady stream of higher-priority intents can starve
  `Bulk` work indefinitely. `SchedulerConfig::with_aging`: a waiting
  intent is walked one priority higher for every `every` ticks it has
  waited, up to a ceiling (`Aging::new(every, up_to)`), ahead of newer
  work at that priority; the gate and the ledger still see the priority
  it was submitted with.
