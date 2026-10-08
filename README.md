<h1 align="center">floodwall</h1>

<p align="center"><em>A barrier for high-volume DevOps in the age of agents.</em></p>

---

A **floodwall** is the permanent barrier a city builds along a river to hold back the water when it rises and protect everything behind it. It is always there. When the flood comes, the wall is what stands between the torrent and the streets.

That is the problem with agent-driven operations. When a fleet of agents is generating infrastructure changes faster than any human can read them, the bottleneck stops being *authoring* changes and becomes *governing* them. The flood is real and it is rising. `floodwall` is the barrier: agents press their changes against it, and a single controlled gate decides what reaches production, in what order, and under whose authority.

## The thesis

DevOps was designed for a world where a human writes each change. Pull requests, approvals, change windows, runbooks: all of it assumes the rate-limiting resource is a person typing. Agents break that assumption. One reconciliation loop can emit thousands of changes an hour; ten of them can bury your prod queue before lunch.

You cannot review your way out of that. You have to **govern throughput**: admit changes at a sustainable rate, run them in an order and combination that limits how much they can hurt, verify each one against policy at the wall, keep a human in the loop for the ones that need one, and keep a record you can trust afterward:

```text
  flood of intents
       |
  [ Admission ]   per-agent rate limit + bounded priority queue (backpressure)
       |
  [ Scheduler ]   only what may run now: wide changes alone, narrow ones in parallel by resource
       |
  [   Gate    ]   deny-overrides stack of policies + conflict check
       |   \
       |    [ Hold ]   deferred intents wait for a human to release or expire them
       |
  [  Ledger   ]   hash-chained record of every verdict and outcome
       |
  dry ground (production)
```

| Stage | Crate module | What it does |
|-------|--------------|--------------|
| **Identity** | [`keyring`](src/keyring.rs) / [`ed25519`](src/ed25519.rs) | Optional: with a keyring of agents' public keys, every intent must carry its agent's Ed25519 signature. Unsigned, unknown and forged intents are refused before they reach the queue or spend an agent's rate limit. |
| **Admission** | [`admission`](src/admission.rs) | A per-agent token bucket caps how fast any one agent can push, so a single runaway loop cannot starve the fleet. A bounded priority queue orders what is waiting (highest priority first, FIFO within a priority) and applies backpressure once it is full. |
| **Scheduler** | [`scheduler`](src/scheduler.rs) | Decides when each waiting intent may start. A `Global` change runs alone; `Region` changes run one at a time with their resource to themselves; narrow changes run in parallel across resources, up to a per-resource in-flight limit. A blocked intent keeps what it waits for from lower-priority work, so wide changes are never starved. Two agents' contradictory changes to one resource within a conflict window are deferred. |
| **Gate** | [`gate`](src/gate.rs) / [`policy`](src/policy.rs) | A stack of policies, each a pure function from an intent to a verdict, composed with **deny-overrides**: the harshest verdict wins, so one `Reject` blocks a change no matter how many policies admit it. |
| **Hold** | [`hold`](src/hold.rs) | A `Defer` is "not yet", not "no". Deferred intents wait here until a human releases them (their deferrals are then waived; rejections still apply) or expires them, or until a TTL runs out. |
| **Ledger** | [`ledger`](src/ledger.rs) | Every decision, release, expiry and outcome is appended to a SHA-256 hash chain together with its evidence: the action, the reason, and each policy's verdict. Each record folds in the previous digest, so any retroactive edit to history breaks the chain. Every so many records the ledger cuts a [checkpoint](src/checkpoint.rs) (chain head + Merkle root), optionally signed by the plane, so an auditor can check the rest of the ledger from a checkpoint without replaying it from genesis. |

The unit that flows through all of it is an [`Intent`](src/intent.rs): a change an agent *wants* to make, fully attributed, tagged with how urgent it is (`Priority`) and how much it can break (`BlastRadius`). Agents never touch production directly. They submit intents. The floodwall decides what runs, when, and alongside what; the caller applies each admitted change and reports back.

## Use

```rust
use floodwall::{Admission, Floodwall, Gate, Outcome, RateLimit, SchedulerConfig, Verdict};
use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};

// Hold up to 1024 waiting intents; let each agent burst 8, refill 1/tick.
let admission = Admission::new(1024, RateLimit::new(8.0, 1.0));

// Three policies, combined deny-overrides.
let gate = Gate::new()
    .with(NoGlobalDestroy)                       // never nuke prod without a human
    .with(BlastNeedsPriority)                    // wide-blast changes need real urgency
    .with(ResourceAllowlist::new(["web", "api"])); // off-list resources are deferred

// Up to two narrow changes per resource at once; contradictions between
// agents within 10 ticks are deferred.
let mut plane = Floodwall::new(admission, gate).with_scheduler(
    SchedulerConfig::default()
        .with_default_limit(2)
        .with_conflict_window(10),
);

// An agent proposes a change.
let intent = Intent::new(
    1,
    AgentId::new("reconciler-7"),
    Action::Scale { resource: "web".into(), replicas: 5 },
    Priority::Normal,
    BlastRadius::Service,
);
let key = intent.key();
plane.submit(intent, 0).unwrap(); // 0 = logical time

// One scheduling pass: everything that may start now is ruled on and
// recorded. Admitted intents are dispatched to you to apply.
let report = plane.tick(0);
assert_eq!(report.decisions[0].verdict, Verdict::Admit);

// Apply the change, then report back. Until you do, it holds its place.
plane.complete(&key, Outcome::Succeeded, 3).unwrap();
assert!(plane.ledger().verify()); // history is intact
```

A deferred intent waits in the hold queue for a human:

```rust
# use floodwall::{Admission, Floodwall, Gate, RateLimit, Verdict};
# use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
# use floodwall::policy::ResourceAllowlist;
# let gate = Gate::new().with(ResourceAllowlist::new(["web", "api"]));
# let mut plane = Floodwall::new(Admission::new(1024, RateLimit::new(8.0, 1.0)), gate);
let intent = Intent::new(
    2,
    AgentId::new("deployer"),
    Action::Apply { resource: "billing".into(), manifest: "v2".into() },
    Priority::Normal,
    BlastRadius::Service,
);
let key = intent.key();
plane.submit(intent, 0).unwrap();
plane.tick(0); // "billing" is off the allowlist: deferred and held

for held in plane.held() {
    println!("{}: {}", held.intent.key(), held.reason);
}

// A human signs off. Its deferrals are waived on the next pass.
plane.release(&key, "alice", 5).unwrap();
let report = plane.tick(5);
assert_eq!(report.decisions[0].verdict, Verdict::Admit);
assert_eq!(report.decisions[0].released_by.as_deref(), Some("alice"));
```

With a keyring, every agent signs its intents, and the ledger proves who asked for what:

```rust
# use floodwall::{Admission, Floodwall, Gate, Keyring, RateLimit, Rejected, SigningKey};
# use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
// Each agent holds a signing key (seeded from a secure random source in
// practice); the plane holds only their public keys.
let deployer = SigningKey::from_seed(&[42; 32]);
let keyring = Keyring::new().with("deployer", deployer.verifying_key());
let mut plane = Floodwall::new(Admission::new(1024, RateLimit::new(8.0, 1.0)), Gate::new())
    .with_keyring(keyring.clone());

let intent = Intent::new(
    1,
    AgentId::new("deployer"),
    Action::Scale { resource: "web".into(), replicas: 5 },
    Priority::Normal,
    BlastRadius::Service,
);
// Unsigned, or changed after signing: refused at the door.
assert_eq!(plane.submit(intent.clone(), 0), Err(Rejected::Unsigned));
plane.submit(intent.signed(&deployer), 0).unwrap();
plane.tick(0);

// An auditor with the public keys checks every record's authorship.
assert_eq!(plane.ledger().verify_signatures(&keyring), Ok(1));
```

Checkpoints let an auditor pick up from where they last checked, with only the new records:

```rust
# use floodwall::{audit_suffix, Admission, Floodwall, Gate, Ledger, RateLimit, SigningKey};
# use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
let plane_key = SigningKey::from_seed(&[7; 32]);
let mut plane = Floodwall::new(Admission::new(1024, RateLimit::new(8.0, 1.0)), Gate::new())
    .with_ledger(Ledger::new().with_checkpoints(2).with_signer(plane_key.clone()));
for id in 0..5 {
    let intent = Intent::new(
        id,
        AgentId::new("deployer"),
        Action::Scale { resource: format!("svc-{id}"), replicas: 3 },
        Priority::Normal,
        BlastRadius::Service,
    );
    plane.submit(intent, 0).unwrap();
}
plane.tick(0); // five decisions recorded: checkpoints at 2 and 4
let latest = plane.checkpoint(); // and one now, at 5

// The auditor already trusted the checkpoint at 2. They check the three
// records after it, and nothing before it.
let trusted = plane.ledger().checkpoints()[0].clone();
let suffix = plane.ledger().records_after(&trusted).unwrap();
assert_eq!(suffix.len(), 3);
assert!(audit_suffix(&trusted, &latest, suffix, Some(&plane_key.verifying_key())).is_ok());
```

### Auditing with your own tools

The ledger exports as [JSON Lines](src/export.rs): a header, then every record and checkpoint, one per line, with the exact bytes each digest and signature covers documented in the crate. Auditors don't need this crate to check it:

```text
$ cargo run --release -- --export audit/      # the demo writes ledger.jsonl, ledger-suffix.jsonl and keys.json
$ node tools/verify-ledger.mjs audit/ledger.jsonl audit/keys.json
ok: 2043 records from genesis; 8 checkpoints; head 189f5d55…
ok: 2043 agent signatures and every checkpoint signature verified
```

[`tools/verify-ledger.mjs`](tools/verify-ledger.mjs) is an independent implementation using only Node's standard library. It recomputes every record digest, checks every link, Merkle root and frontier, and with the public keys checks every agent and checkpoint signature. A suffix export (`Ledger::export_jsonl_from(checkpoint)`) is checked from that checkpoint alone. CI runs it on every change.

Writing your own policy is one trait method:

```rust
use floodwall::intent::Intent;
use floodwall::policy::{Policy, Verdict};

/// Freeze all changes during an incident.
struct FreezeWindow { frozen: bool }

impl Policy for FreezeWindow {
    fn name(&self) -> &str { "freeze-window" }
    fn evaluate(&self, _intent: &Intent) -> Verdict {
        if self.frozen {
            Verdict::Defer("change freeze in effect".into())
        } else {
            Verdict::Admit
        }
    }
}
```

## Demo

```text
$ cargo run --release

floodwall demo - 4000 intents flung at the wall over 200 ticks, settled by tick 385

  at the wall (signatures + admission control)
    forged         : 102 refused (bad signature)
    rate-limited   : 545
    backpressure   : 2407
    queued         : 946

  scheduler (what may run now)
    peak in flight : 7 across 4 resources
    region changes : 26, one at a time
    global changes : 6, each alone

  through the gate (policies + conflict check)
    admitted       : 359
    deferred       : 547 (318 contradicted another agent)
    rejected       : 231

  hold queue (human in the loop)
    released       : 191 (0 still rejected)
    expired        : 194 by the operator, 162 by TTL or a full hold

  applied (reported back)
    succeeded      : 330
    failed         : 29

  ledger (tamper-evident)
    records        : 2043
    head digest    : 189f5d551888eeae1379978c5662e54d7bb4b25323bdf871bbbecd5c0f84c3ca
    chain valid    : true
    signatures     : all 2043 records signed by their agents

  checkpoints (audit without replaying)
    checkpoints    : 8, all signed by the plane
    suffix audit   : records 1792..2043 checked from the checkpoint at 1792: ok
    inclusion      : record 681 proven in the latest root with 11 hashes: true
```

Five agents (including a `chaos-monkey`) fling 4000 changes at the wall. Admission control turns most of the flood away. The scheduler runs what is left in parallel across resources while serializing region-wide and global changes, the gate and conflict check sort each change into admit / defer / reject, and an operator works the hold queue every 10 ticks. Every admitted change is applied and reported back, and the ledger comes out the other side with its chain intact. Every agent signs its intents; the chaos monkey now and then forges one in the deployer's name, which is refused at the door, and every record left in the ledger verifies against the agents' public keys. Finally, an auditor who trusts the second-to-last signed checkpoint checks the rest of the ledger from it alone, and one record is proven to be in the ledger with a handful of hashes.

## Status

| v   | Surface                                                                 | Status |
|-----|-------------------------------------------------------------------------|--------|
| 0.1 | Intent model, per-agent token-bucket admission + bounded priority queue, deny-overrides policy gate, hash-chained ledger, end-to-end `Floodwall` | **shipped** |
| 0.2 | Scheduler: wide-blast serialization, narrow work in parallel by resource, per-resource in-flight limits, conflict detection, hold queue with human release and expiry | **done** |
| 0.3 | Cryptographic ledger: SHA-256 chain, Ed25519-signed records, signed Merkle checkpoints, JSON Lines export with an independent verifier | **done** |
| 0.4 | Persistence + replay: rebuild plane state from the ledger               |  next  |
| 0.5 | Policy-as-code: declarative rules + a worked OPA-style example          |        |

See [GOALS.md](GOALS.md) for the full roadmap and [STATUS.md](STATUS.md) for current state.

## Design notes

- **Zero dependencies.** Everything here is `std`. The ledger is a SHA-256 hash chain; SHA-256 is implemented from scratch (ported from the sibling crate [`shunya`](https://github.com/protosphinx/shunya)), and so are SHA-512 and Ed25519. Each is checked against its standard's test vectors (FIPS 180-4, RFC 8032) and against an independent implementation. The exact bytes each record digest and each signed intent cover are documented in [`ledger`](src/ledger.rs) and [`intent`](src/intent.rs), so an auditor can recompute them. Merkle roots use the RFC 6962 tree shape that Certificate Transparency logs use, so standard tooling can check them.
- **Auditable without this crate.** The JSON Lines export plus the documented encodings are enough to verify everything; `tools/verify-ledger.mjs` proves it in CI, sharing no code with the Rust implementation.
- **Signing is not side-channel audited.** Verification only handles public data. Signing avoids secret-dependent branches where it is easy to, but agents holding long-lived production keys may prefer a vetted library: the signatures are standard Ed25519 and verify here all the same.
- **No wall clock.** Time is a logical tick supplied by the caller, so the whole plane is deterministic and testable. Time never moves backwards: a tick earlier than the latest one seen is treated as the latest.
- **You apply the changes.** floodwall decides; it does not execute. An admitted intent is in flight until you call `complete`, so report back even when a change fails or times out.
- **`unsafe` is forbidden** at the crate level.
- **Tested against its own spec.** Besides unit tests and these README examples (compiled as doctests), [`tests/scheduler_invariants.rs`](tests/scheduler_invariants.rs) runs 300 seeded random floods and checks every scheduling, conflict and hold guarantee above after each step.

## License

MIT
