# STATUS - floodwall

Task ids refer to [GOALS.md](GOALS.md).

## Current state

v0.3 is done: the ledger can be trusted, and audited, by someone who does
not trust whoever holds it. v0.4 is done too: the ledger can be kept on
disk (FW-401), every record carries the tick it was written at (FW-404),
and a restarted plane picks up exactly where it left off by replaying its
ledger (FW-402, FW-405), which a property test checks over random floods
and restarts (FW-403). v0.5 has begun: policies can be written as data,
in a small rules language (FW-501). An `Intent` flows through `Admission`
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
from scratch) and pinned to Rust 1.95. 226 unit tests, 13 doctests
(including the README examples), a randomized invariant test (300 seeded
floods plus 6 signed ones, each ending in checkpoint audits), a replay
property test (150 random floods plus 6 signed ones, with 300-odd
restarts), an edge-case export fixture that is also kept on disk, and 18
tamper tests of the independent verifier; fmt + clippy (`-D warnings`)
clean.

The floodwall.ai site (React + Vite in `site/`, built into `docs/` for
GitHub Pages) describes the scheduler and hold queue.

## Recently shipped

- **FW-501** - policies as data: a small, type-checked rules language
  (`floodwall::rules`, `Gate::with_rules`), in which
  `policies/standard.rules` writes the built-in policies.
- **FW-403** - a property test that replaying the record stream reproduces
  the live decisions: 150 random floods, each replayed whole and restarted
  at random points (from exports, from files, after crashes that cut a
  tick short), with every call's result and the final ledger unchanged,
  and a changed decision refused at exactly its record.
- **FW-402, FW-405** - `Floodwall::resume` rebuilds a plane from its ledger
  by replaying it, checking every record comes out the same: the queue,
  rate-limit buckets, in-flight work, conflict claims, held intents and
  pending releases all come back. Accepted intents are recorded
  (`queued`).
- **FW-404** - every ledger record carries the logical tick it was written
  at (record encoding v3), and ticks never go back along the chain.
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

- **v0.5 policy as code** - FW-502 and FW-503: a worked OPA-style example
  evaluated at the gate, and policy bundles versioned and recorded in the
  ledger alongside verdicts.

## Known gaps

- Resuming establishes that the agents signed what the ledger says, and
  that this plane makes the decisions it shows; not who wrote the file.
  Check the ledger's signed checkpoints against the plane's key for that.
- Resuming needs the plane built exactly as before; the configuration is
  not in the ledger. A difference that changes a decision is caught at the
  first record that comes out differently, but one that changes nothing
  yet is not, and takes effect from the restart on. A plane that started
  from an `Admission` that already held intents cannot be resumed, since
  their arrival is not in its ledger.
- A call that records nothing still moves the plane's clock, which the
  ledger cannot show, so `Floodwall::resume` needs the tick to restart
  at: the latest tick the plane was given, or later (the current time,
  from a clock that never goes back). A caller that passes an earlier one
  gets a plane whose clock is behind where it was.
- The ledger file's lock is advisory on Unix (`flock`), so it binds other
  floodwall processes, not programs that ignore it. On Windows it is
  mandatory and also keeps other programs from reading the file while it
  is open; audit a copy, or the file once it is closed.
- If the process stops between writing a record and the checkpoint it
  completes, the reopened ledger lacks that checkpoint; the next one, or
  `Ledger::checkpoint`, covers those records.
- The whole ledger is still held in memory, and reopening reads all of it.
- A retired agent key (kept for audits after a rotation) verifies any of
  its agent's records. Records now carry their tick (FW-404), so a key
  could be limited to the records before its retirement, but the keyring
  does not record when a key was retired yet.

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
