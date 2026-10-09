# STATUS - floodwall

Task ids refer to [GOALS.md](GOALS.md).

## Current state

v0.2 is done: the wall now schedules. An `Intent` flows through
`Admission` (per-agent token bucket + bounded priority queue with
backpressure) into the scheduler, which starts only what may run now:
a `Global` change alone, `Region` changes one at a time with their
resource to themselves, and narrow changes in parallel across resources
up to a per-resource in-flight limit. Each intent that can start is ruled
on by the deny-overrides policy `Gate` plus a conflict check against other
agents' recent changes to the same resource. Admitted intents are in
flight until the caller reports back; deferred intents wait in a hold
queue for a human to release or expire them. Every decision, release,
expiry and outcome lands in the hash-chained `Ledger`.

Still zero dependencies and pinned to Rust 1.95. 99 unit tests, 6
doctests (including the README examples), and a randomized invariant
test of 300 seeded floods (half of them starting from an `Admission`
that already has work queued), all fmt + clippy (`-D warnings`) clean.

The floodwall.ai site (React + Vite in `site/`, built into `docs/` for
GitHub Pages) describes the scheduler and hold queue.

## Recently shipped

- **v0.2** - FW-201 to FW-207: scheduler stage and in-flight tracking,
  wide-blast serialization, per-resource lanes, conflict detection,
  per-resource in-flight limits, hold queue with human release and
  expiry, and the demo, README and site updates.
- **v0.1.x** - FW-101 to FW-106: robots.txt and sitemap.xml shipped, CI
  check that `docs/` matches `site/`, `RateLimit` validation, refilled
  rate-limit buckets forgotten, ledger evidence, and site stats read from
  the crate.
- **v0.1** - Intent model, admission control, policy gate, hash-chained
  ledger, end-to-end `Floodwall`, demo binary, CI, Dependabot.

## Next up

- **v0.3 ledger** - FW-301 to FW-304: swap FNV-1a for a SHA-256 chain,
  sign records, add Merkle checkpoints and an export format.
- **v0.4 replay** - now also covers recording the tick on every record
  (FW-404) and rebuilding scheduler and hold state (FW-405).

## Known gaps

- A retired agent key (kept for audits after a rotation) verifies any of
  its agent's records, because records do not yet carry the time they were
  written (FW-404).

- An intent the caller never completes holds its place forever (FW-906).
- The `by` in a release or expiry is free text, not a verified identity
  (FW-907).
- Priority is strict, so `Bulk` work can starve under a constant stream of
  higher-priority intents (FW-908).
- Agent signatures prove who asked for each change, but the plane's own
  verdicts are not signed yet: whoever holds the ledger can still rewrite
  verdicts consistently and publish a new head. Having the plane sign its
  Merkle checkpoints (FW-303) is the natural way to close that gap.
