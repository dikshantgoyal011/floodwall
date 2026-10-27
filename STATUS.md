# STATUS - floodwall

Task ids refer to [GOALS.md](GOALS.md).

## Current state

v0.3 is done: the ledger can be trusted, and audited, by someone who does
not trust whoever holds it. v0.4 has begun: the ledger can be kept on
disk (FW-401). So has v0.5: policies can be written as data, in a small
rules language (FW-501). An `Intent` flows through `Admission`
(per-agent token bucket + bounded priority queue with backpressure) into
the scheduler, which starts only what may run now: a `Global` change
alone, `Region` changes one at a time with their resource to themselves,
and narrow changes in parallel across resources up to a per-resource
in-flight limit. Each intent that can start is ruled on by the
deny-overrides policy `Gate` plus a conflict check against other agents'
recent changes to the same resource. Admitted intents are in flight until
the caller reports back; deferred intents wait in a hold queue for a human
to release or expire them.

Every decision, release, expiry and outcome lands in a SHA-256 hash-chained
`Ledger`. With a keyring, agents sign their intents with Ed25519 and every
record carries its agent's signature. The ledger cuts Merkle checkpoints
(RFC 6962) that the plane can sign, so an auditor can check what came after
a trusted checkpoint without replaying from genesis, or prove a single
record with a logarithmic inclusion proof. The whole ledger, or the part
after a checkpoint, exports as JSON Lines, and an independent verifier
using only Node's standard library (`tools/verify-ledger.mjs`) checks every
digest, link, Merkle root and signature, and that every record shows the
intent its agent signed, in CI.

A ledger on disk (`Ledger::create`, `Ledger::open`) is that same JSON
Lines file, written as it grows: every record is written and synced before
it is added, and a plane syncs what each call recorded before the call
returns, so no decision is reported before it is on disk. A failed write
stops the ledger rather than guessing what reached the disk. Opening locks
the file against a second writer, reads it back with a strict JSON reader
of its own, checks it from genesis, and discards only a last line a crash
left unfinished; any other bad line is refused and the file left alone.

Still zero dependencies (SHA-256, SHA-512, Ed25519 and the JSON reader are
from scratch) and pinned to Rust 1.95. 209 unit tests, 12 doctests
(including the README examples), a randomized invariant test (300 seeded
floods plus 6 signed ones, each ending in checkpoint audits), an edge-case
export fixture that is also kept on disk, and 17 tamper tests of the
independent verifier; fmt + clippy (`-D warnings`) clean.

The floodwall.ai site (React + Vite in `site/`, built into `docs/` for
GitHub Pages) describes the scheduler and hold queue.

## Recently shipped

- **FW-501** - policies as data: a small, type-checked rules language
  (`floodwall::rules`, `Gate::with_rules`), in which
  `policies/standard.rules` writes the built-in policies.
- **FW-401** - a durable, append-only ledger on disk: `Ledger::create` and
  `Ledger::open`, a file that is the ledger's own JSON Lines export,
  every decision synced before it is reported, a lock against a second
  writer, and recovery from a crash mid-write.
- **v0.3** - FW-301 to FW-304: SHA-256 hash chain, Ed25519-signed intents
  and records, signed Merkle checkpoints with suffix audits and inclusion
  proofs, and a JSON Lines export with an independent verifier.
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

- **v0.4 persistence + replay** - FW-402 to FW-405: rebuilding admission,
  scheduler and hold state from a reopened ledger (FW-402, FW-405), so a
  restarted plane can carry on where it stopped, the tick on every record
  (FW-404), and a replay property test (FW-403).
- **v0.5 policy as code** - FW-502 and FW-503: a worked OPA-style example
  evaluated at the gate, and policy bundles versioned and recorded in the
  ledger alongside verdicts.

## Known gaps

- A plane cannot resume from a reopened ledger yet: `Floodwall::with_ledger`
  still needs an empty ledger, because the plane's state (queue, in-flight
  and held intents, rate buckets) is not rebuilt from the records until
  FW-402 and FW-405. A reopened ledger can be audited, exported and
  appended to directly.
- The ledger file's lock is advisory on Unix (`flock`), so it binds other
  floodwall processes, not programs that ignore it. On Windows it is
  mandatory and also keeps other programs from reading the file while it
  is open; audit a copy, or the file once it is closed.
- If the process stops between writing a record and the checkpoint it
  completes, the reopened ledger lacks that checkpoint; the next one, or
  `Ledger::checkpoint`, covers those records.
- The whole ledger is still held in memory, and reopening reads all of it.
- A retired agent key (kept for audits after a rotation) verifies any of
  its agent's records, because records do not yet carry the time they were
  written (FW-404).

- An intent the caller never completes holds its place forever (FW-906).
- The `by` in a release or expiry is free text, not a verified identity
  (FW-907).
- Priority is strict, so `Bulk` work can starve under a constant stream of
  higher-priority intents (FW-908).
- The plane's verdicts are protected once a checkpoint covering them is
  signed (`Ledger::with_signer`). Records after the latest signed
  checkpoint can still be rewritten by whoever holds the ledger until the
  next one is cut, so pick the checkpoint interval with that window in
  mind, or cut one with `Floodwall::checkpoint` when it matters.
- Ed25519 signing is from scratch and not side-channel audited; agents
  holding long-lived production keys may prefer to sign with a vetted
  library (the signatures verify here all the same).
