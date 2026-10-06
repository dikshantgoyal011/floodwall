<h1 align="center">floodwall</h1>

<p align="center"><em>A barrier for high-volume DevOps in the age of agents.</em></p>

---

A **floodwall** is the permanent barrier a city builds along a river to hold back the water when it rises and protect everything behind it. It is always there. When the flood comes, the wall is what stands between the torrent and the streets.

That is the problem with agent-driven operations. When a fleet of agents is generating infrastructure changes faster than any human can read them, the bottleneck stops being *authoring* changes and becomes *governing* them. The flood is real and it is rising. `floodwall` is the barrier: agents press their changes against it, and a single controlled gate decides what reaches production, in what order, and under whose authority.

## The thesis

DevOps was designed for a world where a human writes each change. Pull requests, approvals, change windows, runbooks: all of it assumes the rate-limiting resource is a person typing. Agents break that assumption. One reconciliation loop can emit thousands of changes an hour; ten of them can bury your prod queue before lunch.

You cannot review your way out of that. You have to **govern throughput**: admit changes at a sustainable rate, order them by how much they can hurt, verify each one against policy at the wall, and keep a record you can trust afterward. Four pieces:

```
  flood of intents
       |
  [ Admission ]   per-agent rate limit + bounded priority queue (backpressure)
       |
  [   Gate    ]   deny-overrides stack of policies
       |
  [  Ledger   ]   hash-chained record of every verdict
       |
  dry ground (production)
```

| Stage | Crate module | What it does |
|-------|--------------|--------------|
| **Admission** | [`admission`](src/admission.rs) | A per-agent token bucket caps how fast any one agent can push, so a single runaway loop cannot starve the fleet. A bounded priority queue orders what is waiting (highest priority first, FIFO within a priority) and applies backpressure once it is full. |
| **Gate** | [`gate`](src/gate.rs) / [`policy`](src/policy.rs) | A stack of policies, each a pure function from an intent to a verdict, composed with **deny-overrides**: the harshest verdict wins, so one `Reject` blocks a change no matter how many policies admit it. |
| **Ledger** | [`ledger`](src/ledger.rs) | Every decision, admit or reject, is appended to a hash chain together with its evidence: the action, the reason, and each policy's verdict. Each record folds in the previous digest, so any retroactive edit to history breaks the chain. |

The unit that flows through all of it is an [`Intent`](src/intent.rs): a change an agent *wants* to make, fully attributed, tagged with how urgent it is (`Priority`) and how much it can break (`BlastRadius`). Agents never touch production directly. They submit intents. The floodwall decides.

## Use

```rust
use floodwall::{Admission, Floodwall, Gate, RateLimit, Verdict};
use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};

// Hold up to 1024 waiting intents; let each agent burst 8, refill 1/tick.
let admission = Admission::new(1024, RateLimit::new(8.0, 1.0));

// Three policies, combined deny-overrides.
let gate = Gate::new()
    .with(NoGlobalDestroy)                       // never nuke prod without a human
    .with(BlastNeedsPriority)                    // wide-blast changes need real urgency
    .with(ResourceAllowlist::new(["web", "api"])); // off-list resources are deferred

let mut plane = Floodwall::new(admission, gate);

// An agent proposes a change.
plane.submit(
    Intent::new(
        1,
        AgentId::new("reconciler-7"),
        Action::Scale { resource: "web".into(), replicas: 5 },
        Priority::Normal,
        BlastRadius::Service,
    ),
    0, // logical time
).unwrap();

// Pull it through the gate; the verdict is recorded in the ledger.
let decision = plane.tick().unwrap();
assert_eq!(decision.verdict, Verdict::Admit);
assert!(plane.ledger().verify()); // history is intact
```

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

```
$ cargo run --release

floodwall demo - 4000 intents flung at the wall over 200 ticks

  at the wall (admission control)
    rate-limited : 451
    backpressure : 3037
    queued       : 512

  through the gate (policy verification)
    admitted     : 207
    deferred     : 120
    rejected     : 185

  ledger (tamper-evident)
    records      : 512
    head digest  : 0x5b8f01788b0073ca
    chain valid  : true
```

Five agents (including a `chaos-monkey`) fling 4000 changes at the wall. Admission control turns most of the flood away, the gate sorts the survivors into admit / defer / reject, and the ledger comes out the other side with its chain intact.

## Status

| v   | Surface                                                                 | Status |
|-----|-------------------------------------------------------------------------|--------|
| 0.1 | Intent model, per-agent token-bucket admission + bounded priority queue, deny-overrides policy gate, hash-chained ledger, end-to-end `Floodwall` | **shipped** |
| 0.2 | Cooperative scheduler: serialize wide-blast intents, run narrow ones in parallel by resource |  next  |
| 0.3 | Cryptographic ledger (SHA-256 chain, signed records) + Merkle checkpoints |        |
| 0.4 | Persistence + replay: rebuild plane state from the ledger               |        |
| 0.5 | Policy-as-code: declarative rules + a worked OPA-style example          |        |

See [GOALS.md](GOALS.md) for the full roadmap and [STATUS.md](STATUS.md) for current state.

## Design notes

- **Zero dependencies.** Everything here is `std`. The hash chain is a hand-rolled FNV-1a placeholder (swap in a real cryptographic hash before trusting it against an adversary; the sibling crate [`shunya`](https://github.com/protosphinx/shunya) has a from-scratch SHA-256).
- **No wall clock.** Time is a logical tick supplied by the caller, so admission control is fully deterministic and testable.
- **`unsafe` is forbidden** at the crate level.

## License

MIT
