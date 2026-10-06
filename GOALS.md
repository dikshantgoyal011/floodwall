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

## v0.1.x - hardening *(new)*

Small fixes found reviewing v0.1. None change the public model.

- **FW-101** Ship `robots.txt` and `sitemap.xml` to floodwall.ai: they were
  added to `site/public/` but `docs/` was never rebuilt.
- **FW-102** CI check that fails when `docs/` is out of date with a fresh
  `site/` build, so the published site cannot drift from its source again.
- **FW-103** Validate `RateLimit`: a `burst` below `1.0` means the bucket can
  never hold a whole token, so every intent from every agent is silently
  rate-limited. Reject non-finite, negative, or sub-1 bursts up front.
- **FW-104** Bound the per-agent bucket map. Buckets are never evicted, so a
  fleet that mints fresh agent ids grows memory without limit. Drop buckets
  that have refilled to `burst` and been idle past a horizon.
- **FW-105** Make ledger records carry the evidence: the verdict reason, the
  per-policy breakdown, and a summary of the action. Today a record holds
  only the `admit` / `defer` / `reject` label.
- **FW-106** Keep the site's hero stats (version, dependency and test counts)
  in step with the crate instead of hard-coding them.

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

## v0.3 - trustworthy ledger ◦ next

- **FW-301** Replace FNV-1a with a SHA-256 chain (reuse the from-scratch
  primitive from `shunya`).
- **FW-302** Per-record signatures keyed by agent identity.
- **FW-303** Periodic Merkle checkpoints so a verifier can audit a suffix
  without replaying from genesis.
- **FW-304** *(new)* A plain export format (JSON Lines) so auditors can
  verify the chain with their own tooling.

## v0.4 - persistence + replay

- **FW-401** Durable, append-only ledger on disk.
- **FW-402** Rebuild full plane state (buckets, queue watermarks) from the
  ledger on restart.
- **FW-403** Property test: replay(record-stream) reproduces the live
  decisions.
- **FW-404** *(new)* Record the tick on every ledger record. Conflict
  windows and hold TTLs depend on time, so replay needs it.
- **FW-405** *(new)* Rebuild scheduler and hold state (in-flight intents,
  conflict claims, held intents, pending releases) from the ledger, not
  just admission state.

## v0.5 - policy as code

- **FW-501** Declarative policy format so rules are data, not Rust.
- **FW-502** A worked OPA/Rego-style example evaluated at the gate.
- **FW-503** Policy bundles versioned and recorded in the ledger alongside
  verdicts.

## Later

- **FW-901** Backpressure signalling back to agents (a credit/quota
  protocol) so a well-behaved fleet self-throttles before it hits the wall.
- **FW-902** Distributed floodwall: shard by resource, gossip the ledger
  heads.
- **FW-903** Formal model (TLA+) of the admit/serialize/commit protocol with
  safety (no two conflicting changes commit) and liveness (every admitted
  intent eventually decides) obligations.
- **FW-904** *(new)* Observability: per-agent admit / defer / reject
  counters, queue depth, and rate-limit hits, exposed without adding a
  runtime dependency.
- **FW-905** *(new)* Throughput benchmarks for admission and the gate, so
  the scheduler and SHA-256 work can be measured against v0.1.
- **FW-906** *(new)* Optional in-flight leases: surface (or auto-fail)
  intents in flight longer than a configured number of ticks. Today an
  intent the caller never completes holds its resource forever.
- **FW-907** *(new)* Authenticated release and expiry. `by` is a free-text
  name recorded in the ledger; tie it to a verified operator identity
  (and sign it once records are signed, FW-302).
- **FW-908** *(new)* Optional aging for low-priority work. Priority is
  strict, so a steady stream of higher-priority intents can starve
  `Bulk` work indefinitely.
