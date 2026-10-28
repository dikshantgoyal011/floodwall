# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A worked example of OPA/Rego-style policies at the gate (FW-502).
  `policies/production.rules` writes a platform team's production
  guardrails as rules: images only from the internal registry, no agent
  taking a database or queue to zero, service ownership, scale bounds that
  wait for a human, more urgency for wider changes, and chaos agents kept in
  staging. `policies/README.md` sets each one next to the Rego it stands
  for and says what carries over and what does not, and
  `cargo run --example production` runs them at the gate.
  `tests/production_policies.rs` transcribes the Rego into Rust and checks
  the rules decide exactly as it does, with the same messages, on 24,576
  intents either side of every boundary, and that the walkthrough's output
  and quoted policies are the example's and the file's.
- Policies as data (FW-501). `floodwall::rules` reads a small declarative
  rules language: named policies, each a list of `reject "reason" when
  <condition>` and `defer "reason" when <condition>` rules, with
  conditions over an intent's agent, resource, manifest, kind, replicas,
  priority and blast radius (comparisons, `in`/`not in` lists, `*`
  patterns, `destructive`, `not`/`and`/`or`, parentheses) and reasons
  that name its fields (`{resource}`, `{agent}`, ...). A policy's verdict
  is the harshest of its rules that hold, with the first one's reason.
  Files are checked when read: unknown fields, values of the wrong type,
  orderings of unordered fields, duplicate or reserved policy names and
  other mistakes are a `ParseError` with the line and column. `rules::parse`
  returns `RulePolicy`s, which are `Policy`s like any other, and
  `Gate::with_rules` adds a whole file to a gate. Zero dependencies.
  `policies/standard.rules` writes the built-in policies as rules, and a
  test checks it rules exactly as they do on every combination of action,
  priority and blast radius.
- `ledger::Evidence`: each `Record` now carries the action summary, the
  verdict's reason, and every policy's verdict, all covered by the
  digest. `Ledger::append_with` records it; `Floodwall::tick` fills it in.
  (FW-105)
- `Display` for `Action` (`apply web`, `scale web to 5`, `destroy web`)
  and `Verdict::reason()`.
- Scheduler stage between admission and the gate (FW-201). An admitted
  intent is now *in flight*: the caller applies it and reports back with
  `Floodwall::complete(key, Outcome, now)`, which is recorded in the
  ledger as `succeeded` or `failed`. `Floodwall::in_flight`, `queued`,
  `is_in_flight` and `clock` expose the plane's state. `IntentKey`
  (agent + id) identifies an intent; `Intent::key()` returns it.
- `Admission::waiting` (the queue in order) and `Admission::is_full`.
- Wide-blast intents are serialized (FW-202). A `Global` intent waits for
  everything in flight and then runs alone; `Region` intents run one at a
  time and need their resource to themselves. A blocked wide intent keeps
  what it is waiting for from lower-priority work behind it, so it cannot
  be starved.
- Narrow intents are partitioned by resource (FW-203): work on different
  resources runs concurrently, and work on one resource runs one intent at
  a time, highest priority first.
- Conflict detection on `(resource, action)` (FW-204). A dispatched intent
  claims its `(resource, action)` while in flight and for a conflict
  window after it completes (`SchedulerConfig::with_conflict_window`,
  default 10 ticks). Another agent's contradictory intent
  (`Action::contradicts`) is deferred when its turn comes. The check
  shows in every decision's breakdown as `conflict-window` and combines
  deny-overrides with the gate, so a policy reject still wins.
  `Floodwall::with_scheduler` sets the configuration.
- Per-resource in-flight limits (FW-205):
  `SchedulerConfig::with_default_limit(n)` and `with_limit(resource, n)`
  let up to `n` narrow intents run on a resource at once (default 1). A
  `Region` intent still needs its resource to itself. A limit of 0 is
  refused, since it would block the resource forever.
- Hold queue for deferred intents (FW-206). A `Defer` no longer drops the
  intent: it is held (`Floodwall::held`, `is_held`) until a human acts.
  `Floodwall::release(key, by, now)` sends it back to the queue, and on
  its next evaluation its deferrals (policy defers and conflicts) are
  waived; rejections and scheduling still apply, and it never runs
  alongside another agent's contradictory change that is in flight.
  `Floodwall::expire(key, by, now)` drops it. `HoldConfig` sets a
  capacity (oldest evicted when full, default 1024) and an optional TTL;
  expiries are reported in `TickReport::expired`. The ledger records
  `released` and `expired` with who did it and why, and a released
  decision's reason lists what was overridden (`Decision::released_by`).
- Demo, README and site for v0.2 (FW-207). The demo follows a flood
  through scheduling, conflicts, an operator working the hold queue, and
  completions. The README's examples are compiled and run as doctests.
- `tests/scheduler_invariants.rs`: 300 seeded random floods through the
  public API, with random limits, conflict windows, hold capacities and
  TTLs, a policy that changes over time, and random releases and
  expiries. Checks exclusivity, limits, no overtaking, maximal passes,
  conflicts against an independent model, that every live intent is in
  exactly one place, that a released intent is never deferred again,
  duplicate detection, ledger completeness, and that everything drains.

### Changed

- A property test that replaying the record stream reproduces the live
  decisions (FW-403): `tests/replay_property.rs` floods 150 randomly
  configured planes (and 6 signed ones), checks every tick's report is
  exactly what it recorded, replays each whole ledger on a new plane,
  restarts the same flood at random points (from an export, from a file,
  and after a crash that cut a tick short) and requires every call's
  result, the final state and the final ledger to match the flood run
  straight through, and changes one decision in each ledger (re-hashing
  the chain) to require the replay to refuse it at exactly that record.
  It found that a restart lost clock moves no record shows, which
  `Floodwall::resume`'s `now` fixes.
- A plane picks up where it left off after a restart (FW-402, FW-405).
  `Floodwall::resume(ledger, now)` replays a plane's ledger on a newly built
  plane with the same configuration: it makes the same calls at the same
  ticks and checks each one writes exactly the record the ledger holds,
  so the queue and its order, every agent's rate-limit bucket, what is in
  flight and since when, every conflict claim, what is held and why, and
  pending releases all come back as they were. A plane built differently,
  or a ledger holding a decision the plane would not have made, is refused
  with `ResumeError::Diverged` at the first record that comes out
  differently (saying what differs); records no plane writes are
  `ResumeError::Unreplayable`. A tick a crash cut short is finished.
  With a keyring, every intent in the ledger must be signed by its agent
  (current or retired key), or resuming fails with
  `ResumeError::Unauthenticated`: a ledger's hashes alone prove nothing
  about who asked. Pending intents are checked again against the current
  keyring when next ruled on, so a retired key never authorizes new work.
  `now` is the tick the plane restarts at (the latest tick it
  was given, or later): a call that recorded nothing still moved the
  clock, which the ledger cannot show.
  - **Breaking:** every intent that gets into the queue is now recorded,
    as `queued` (`QUEUED`), and synced before `submit` returns, so an
    accepted intent is not lost if the plane stops before ruling on it.
    Ledgers have one more record per accepted intent.
  - A rate-limited attempt no longer changes the agent's bucket: the
    refill is only kept with the token it pays for, so a bucket depends
    only on the intents that got in (which the ledger records), and is the
    same floating-point sum however many attempts came between.
  - `Floodwall::with_ledger` points to `resume` for a ledger with records.
  - The demo's `--ledger FILE` restarts the plane from its file halfway
    through the flood; CI checks the ledger is the same bytes as a run
    without the restart.
- **Breaking:** every ledger record carries the logical tick it was
  written at (FW-404): `Record::tick`, covered by the digest under record
  encoding `floodwall/ledger/record/v3` (the tick follows `seq`). The
  ledger keeps a clock that only moves forward (`Ledger::clock`,
  `Ledger::advance_clock`); a `Floodwall` keeps it at the plane's own
  clock, so every decision, release, expiry and outcome shows when it
  happened. `Floodwall::with_ledger` brings whichever of the two clocks is
  behind up to the other, so they never disagree. `Ledger::verify`,
  `Ledger::open` and `Ledger::read_jsonl` refuse a record whose tick is
  earlier than the one before it. The JSON Lines export writes `"tick"`
  as a decimal string after `"seq"` (a tick can exceed 2^53) and names
  record encoding v3 in its header;
  `tools/verify-ledger.mjs` checks both, and the edge-case fixture has
  ticks past 2^53. The reference digests are pinned again from an
  independent implementation of v3.
- Durable, append-only ledger on disk (FW-401). `Ledger::create(path)`
  starts a ledger in a new file and `Ledger::open(path)` picks it up again
  after a restart or crash; the file is the ledger's JSON Lines export,
  written as it grows, so `tools/verify-ledger.mjs` checks the live file
  too. Every record and checkpoint is written and synced before it is
  added, and a `Floodwall` syncs what each call recorded before the call
  returns, so no decision is reported before it is on disk. Opening locks
  the file against a second writer (`ReadError::InUse`), checks every line
  from genesis as `Ledger::verify` does, discards an unfinished last line
  left by a crash (`Ledger::discarded_on_open`), and refuses any complete
  line that is not exactly what floodwall writes or does not verify
  (`ReadError::Invalid`, with its line and byte offset), leaving the file
  untouched. `Ledger::read_jsonl` reads a whole-ledger export back into a
  ledger in memory. A failed write or sync stops the ledger: the new
  `try_append`, `try_append_with`, `try_append_intent` and
  `try_checkpoint` return `WriteError`, while `append`, `append_with`,
  `append_intent`, `checkpoint` and the plane's recording calls panic, so
  nothing acts on a decision that may not be on disk. A small strict JSON
  reader (zero dependencies, as ever) backs it; the demo takes
  `--ledger FILE`, and CI checks that the demo's and the edge-case
  fixture's ledger files are their exports byte for byte.
- JSON Lines export for auditors (FW-304). `Ledger::export_jsonl` writes
  a header, every record and every checkpoint, one JSON object per line;
  `Ledger::export_jsonl_from(checkpoint)` writes only what follows a
  trusted checkpoint, and refuses a checkpoint that does not match the
  ledger. The format is documented in `floodwall::export` (u64 values
  that can exceed 2^53, like `intent_id`, are decimal strings). Each
  record carries the intent it is about, as its agent signed it, so an
  auditor can recompute the intent's digest and check that the record
  shows that request. Checkpoint sizes strictly increase: a suffix export
  from a size-0 checkpoint writes it once. `export::keys_json` writes the
  public keys an auditor needs, retired ones included, and
  `Keyring::iter` / `Keyring::retired` list them. The demo takes
  `--export DIR`. `tools/verify-ledger.mjs` is an independent verifier
  using only Node's standard library. It refuses anything that is not
  exactly the documented format (unknown or missing fields, other types,
  number or string spellings, duplicate keys, invalid UTF-8), a suffix
  export that ends before its starting checkpoint, a repeated checkpoint,
  and a keys file that is given but is not a valid keys object or holds a
  key floodwall would refuse (a weak one, say); only leaving the keys
  file out means checking hashes alone. CI runs it on the demo's export
  and on an edge-case fixture (including an agent that rotated its key),
  plus tamper tests.
- Merkle checkpoints (FW-303). `floodwall::merkle` builds RFC 6962
  Merkle trees over record digests (`root`, `inclusion_proof`,
  `verify_inclusion`, and an incremental `Frontier`, whose `try_push`
  refuses to grow past `u64::MAX` leaves with `FrontierFull`, leaving it
  unchanged).
  `Ledger::with_checkpoints(n)` cuts a `Checkpoint` (size, chain head,
  Merkle root, frontier) every `n` records, `Ledger::with_signer(key)`
  signs each with the plane's key, and `Ledger::checkpoint` /
  `Floodwall::checkpoint` cut one now. `audit_suffix(trusted, latest,
  records, key)` checks the records after a trusted checkpoint without
  any before it; `Ledger::records_after` hands them over and
  `Ledger::prove_inclusion` proves a single record in O(log n) hashes.
  `Ledger::verify` also checks stored checkpoints against the records;
  `Ledger::verify_checkpoint_signatures` checks their signatures.
  `Floodwall::with_ledger` sets up the plane's ledger.
- **Breaking:** signed intents and records (FW-302). Agents sign intents
  with Ed25519 (`Intent::signed`); `Intent::digest` is SHA-256 over a
  documented encoding of every field but the signature, and `Priority`
  and `BlastRadius` now have explicit discriminants because they are part
  of it. `Floodwall::with_keyring` requires every intent to be signed by
  its agent's key on a `Keyring`: `submit` refuses unsigned, unknown and
  forged intents with the new `Rejected::Unsigned`, `UnknownAgent` and
  `BadSignature`, before the duplicate check and the rate limit; intents
  that reached the queue another way are checked when ruled on (breakdown
  entry `agent-signature`). A ledger record about an intent stores the
  intent itself, signature and all (`Record::intent`, with
  `intent_digest()` and `signature()`), covered by the record digest
  (record encoding now `v2`). `Ledger::append_intent(intent, verdict,
  reason, policies)` takes the record's intent id, agent and action summary
  from the intent, `Ledger::verify` rejects a record that disagrees with
  its intent, and `Ledger::verify_signatures` checks every record's
  signature of its recomputed intent digest against a keyring.
  `Keyring::with_retired` keeps rotated-out keys for audits only.
  Ed25519 (`floodwall::ed25519`: `SigningKey`, `VerifyingKey`,
  `Signature`) and SHA-512 (`floodwall::sha512`) are from scratch;
  `VerifyingKey::from_bytes` refuses weak, small-order keys
  (`InvalidKey::Weak`). Without a keyring, signatures are optional and
  unchecked, as before.
- **Breaking:** the ledger is a SHA-256 hash chain instead of FNV-1a
  (FW-301). `Record::prev`, `Record::digest` and `Ledger::head()` are a
  32-byte `ledger::Digest` (shown as hex) instead of a `u64`; the genesis
  `prev` is `Digest::GENESIS`, all zeros. Every record digest is
  domain-separated and its exact encoding is documented in `ledger`;
  `Record::compute_digest` recomputes it. `Ledger::verify` now also
  checks that each record is at its position and that the chain ends at
  the head, so a truncated ledger fails. SHA-256 is from scratch in
  `floodwall::sha256` (one-shot `sha256` and streaming `Sha256`), ported
  from `shunya`.
- **Breaking:** `Floodwall::tick()` is now `tick(now) -> TickReport`. One
  call is a full pass over the queue that rules on every intent that may
  start now, instead of popping a single intent. `TickReport::admitted()`
  lists what was dispatched.
- **Breaking:** `Rejected::Duplicate`: `Floodwall::submit` refuses an
  intent whose key is already queued, in flight or held, before it
  touches the agent's rate limit.
- `Floodwall` keeps one clock across all its methods; a `now` earlier
  than the latest tick seen is treated as that tick.
- `Floodwall::new` adopts an `Admission` that already has intents
  queued: they become live (their keys are refused as duplicates) and the
  plane's clock starts at the controller's. It panics if two queued
  intents share a key; `Floodwall::try_new` returns `DuplicateQueued`
  instead.
- `RateLimit::new` and `Admission::new` now panic on a limit that could
  never admit anything sensibly: a `burst` below `1.0` (which used to
  rate-limit every intent silently), or a NaN, infinite, or negative
  parameter. `RateLimit::try_new` returns an `InvalidRateLimit` error
  instead of panicking. (FW-103)
- `Admission` time never moves backwards: it keeps the latest tick any
  call has supplied (`Admission::clock`), and a `submit` or `prune_idle`
  stamped earlier is treated as that tick. Previously an earlier tick
  skipped refill for that one call. (FW-104)
- Ledger digests length-prefix every text field, so field boundaries are
  unambiguous. Head digests differ from 0.1.0 for the same history.

### Fixed

- `Admission` no longer keeps a rate-limit bucket for every agent id it
  has ever seen. Once the tracked set passes a threshold, agents whose
  buckets have refilled are forgotten; a full bucket is identical to a
  new one and time never moves backwards, so no decision changes.
  `Admission::prune_idle` and `Admission::tracked_agents` expose this
  directly. (FW-104)

## [0.1.0] - 2026-06-28

### Added

- `intent`: `Intent`, `Action` (apply / scale / destroy), `AgentId`,
  `Priority`, and `BlastRadius` - the attributed unit of work.
- `admission`: `Admission` controller with per-agent token-bucket rate
  limiting (`RateLimit`) and a bounded priority queue (highest priority
  first, FIFO within a priority) that applies backpressure when full.
  Logical-clock time, so behaviour is deterministic.
- `policy`: the `Policy` trait, the `Verdict` type, and three reference
  policies - `NoGlobalDestroy`, `BlastNeedsPriority`, `ResourceAllowlist`.
- `gate`: `Gate`, a deny-overrides stack of policies that records a full
  per-policy breakdown for every decision.
- `ledger`: `Ledger`, an append-only FNV-1a hash chain with `verify()`
  that detects any retroactive edit to history.
- `Floodwall`: the control plane tying admission, gate, and ledger
  together (`submit` / `tick`).
- A `floodwall` demo binary that floods the wall with 4000 intents across
  five agents.
- CI (fmt / clippy `-D warnings` / test / build) and Dependabot for cargo
  and GitHub Actions.

[0.1.0]: https://github.com/erphq/floodwall/releases/tag/v0.1.0
