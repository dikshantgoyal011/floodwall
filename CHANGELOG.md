# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Changed

- **Breaking:** `Floodwall::tick()` is now `tick(now) -> TickReport`. One
  call is a full pass over the queue that rules on every intent that may
  start now, instead of popping a single intent. `TickReport::admitted()`
  lists what was dispatched.
- **Breaking:** `Rejected::Duplicate`: `Floodwall::submit` refuses an
  intent whose key is already queued or in flight, before it touches the
  agent's rate limit.
- `Floodwall` keeps one clock across all its methods; a `now` earlier
  than the latest tick seen is treated as that tick.

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
