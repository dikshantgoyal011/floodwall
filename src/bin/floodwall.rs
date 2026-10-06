//! `floodwall` demo.
//!
//! Simulate a flood of agent-generated changes hitting the wall, then drain it,
//! and show admission control, the policy gate, and the tamper-evident ledger
//! working together. Deterministic and dependency-free.

use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};
use floodwall::{Admission, Floodwall, Gate, Outcome, RateLimit, Rejected, Verdict};

/// A tiny xorshift PRNG so the demo is reproducible without pulling in `rand`.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
}

fn main() {
    let agents = [
        "reconciler-1",
        "reconciler-2",
        "deployer",
        "autoscaler",
        "chaos-monkey",
    ];
    let resources = ["web", "api", "cache", "billing", "ledger-db"];

    // Tight per-agent limit against a deliberately oversized flood, so rate
    // limiting and backpressure both bite.
    // The fleet may act on the core services freely; touching "billing" or
    // "ledger-db" is held for a human (deferred, not rejected).
    let allowlist = ["web", "api", "cache"];
    let admission = Admission::new(512, RateLimit::new(8.0, 2.0));
    let gate = Gate::new()
        .with(NoGlobalDestroy)
        .with(BlastNeedsPriority)
        .with(ResourceAllowlist::new(allowlist));
    let mut plane = Floodwall::new(admission, gate);

    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let ticks = 200u64;
    let per_tick = 20u64;

    let mut offered = 0u64;
    let mut rate_limited = 0u64;
    let mut backpressure = 0u64;
    let mut next_id = 0u64;

    // Flood phase: agents press intents against the wall across logical ticks.
    for now in 0..ticks {
        for _ in 0..per_tick {
            let agent = AgentId::new(agents[rng.below(agents.len() as u64) as usize]);
            let resource = resources[rng.below(resources.len() as u64) as usize].to_string();
            let blast = match rng.below(10) {
                0 => BlastRadius::Global,
                1 | 2 => BlastRadius::Region,
                3..=5 => BlastRadius::Service,
                _ => BlastRadius::Cell,
            };
            let priority = match rng.below(10) {
                0 => Priority::Pager,
                1 | 2 => Priority::Urgent,
                3..=6 => Priority::Normal,
                _ => Priority::Bulk,
            };
            let action = match rng.below(3) {
                0 => Action::Apply {
                    resource,
                    manifest: "<rendered manifest>".into(),
                },
                1 => Action::Scale {
                    resource,
                    replicas: rng.below(6) as u32,
                },
                _ => Action::Destroy { resource },
            };

            let intent = Intent::new(next_id, agent, action, priority, blast);
            next_id += 1;
            offered += 1;
            match plane.submit(intent, now) {
                Ok(()) => {}
                Err(Rejected::RateLimited) => rate_limited += 1,
                Err(Rejected::Backpressure) => backpressure += 1,
                Err(Rejected::Duplicate) => unreachable!("every intent id is fresh"),
            }
        }
    }

    // Drain phase: pull everything still waiting through the gate, applying
    // each admitted change straight away.
    let mut admitted = 0u64;
    let mut deferred = 0u64;
    let mut rejected = 0u64;
    let mut now = ticks;
    while plane.pending() > 0 {
        let report = plane.tick(now);
        for decision in &report.decisions {
            match decision.verdict {
                Verdict::Admit => admitted += 1,
                Verdict::Defer(_) => deferred += 1,
                Verdict::Reject(_) => rejected += 1,
            }
        }
        for key in report.admitted().map(Intent::key) {
            plane
                .complete(&key, Outcome::Succeeded, now)
                .expect("dispatched this tick");
        }
        now += 1;
    }

    let queued = offered - rate_limited - backpressure;
    println!("floodwall demo - {offered} intents flung at the wall over {ticks} ticks\n");
    println!("  at the wall (admission control)");
    println!("    rate-limited : {rate_limited}");
    println!("    backpressure : {backpressure}");
    println!("    queued       : {queued}");
    println!();
    println!("  through the gate (policy verification)");
    println!("    admitted     : {admitted}");
    println!("    deferred     : {deferred}");
    println!("    rejected     : {rejected}");
    println!();
    println!("  ledger (tamper-evident)");
    println!("    records      : {}", plane.ledger().len());
    println!("    head digest  : {:#018x}", plane.ledger().head());
    println!("    chain valid  : {}", plane.ledger().verify());
}
