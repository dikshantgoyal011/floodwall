//! Property: a plane's stats are exactly what its calls returned (FW-904).
//!
//! Each seed builds a randomly configured plane and floods it with random
//! calls: submissions from several agents (duplicates, rate-limited and
//! backpressured ones, and in signed floods unsigned, forged and unknown
//! ones), ticks, releases, expiries by hand and by TTL or eviction,
//! outcomes of both kinds, and, under a lease, what it is slow to complete
//! reported or lapsed, with restarts from the ledger at random points.
//!
//! Alongside, it keeps its own tally from nothing but what each public call
//! returned: a submission's `Result`, a tick's decisions and expiries, a
//! release's or expiry's or completion's `Ok`. After every call the plane's
//! stats must be that tally, agent by agent and in all, and its gauges must
//! be what the plane shows: the queue, its peak since the plane was built
//! or resumed, what is in flight and past its lease, and what is held. A restart starts both
//! afresh. On a signed plane, what is refused at the door in the name of an
//! agent outside the keyring is untracked.

use std::collections::BTreeMap;

use floodwall::intent::{Action, AgentId, BlastRadius, Intent, IntentKey, Priority};
use floodwall::policy::{NoGlobalDestroy, ResourceAllowlist};
use floodwall::{
    Admission, Counts, Floodwall, Gate, HoldConfig, Keyring, Lease, Ledger, Outcome, RateLimit,
    Rejected, SchedulerConfig, SigningKey, Verdict,
};

const AGENTS: [&str; 4] = ["a", "b", "c", "d"];
const RESOURCES: [&str; 4] = ["web", "api", "cache", "db"];

/// A small, seeded xorshift generator: the same seed, the same flood.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

fn key(agent: &str) -> SigningKey {
    SigningKey::from_seed(&[agent.as_bytes()[0]; 32])
}

#[derive(Clone)]
struct Config {
    capacity: usize,
    burst: f64,
    refill: f64,
    no_global_destroy: bool,
    allowlist: Vec<&'static str>,
    window: u64,
    hold_capacity: usize,
    ttl: Option<u64>,
    signed: bool,
    lease: Option<Lease>,
}

impl Config {
    fn random(rng: &mut Rng, signed: bool) -> Self {
        Self {
            capacity: *rng.pick(&[2, 6, 32]),
            burst: *rng.pick(&[1.0, 2.0, 4.0]),
            refill: *rng.pick(&[0.0, 0.5, 1.0]),
            no_global_destroy: rng.chance(70),
            allowlist: RESOURCES
                .iter()
                .copied()
                .filter(|_| rng.chance(60))
                .collect(),
            window: *rng.pick(&[0, 3, 10]),
            hold_capacity: *rng.pick(&[1, 3, 64]),
            ttl: *rng.pick(&[None, Some(2), Some(6)]),
            signed,
            lease: *rng.pick(&[
                None,
                Some(Lease::Report(2)),
                Some(Lease::Fail(2)),
                Some(Lease::Fail(5)),
            ]),
        }
    }

    fn plane(&self) -> Floodwall {
        let mut gate = Gate::new().with(ResourceAllowlist::new(self.allowlist.iter().copied()));
        if self.no_global_destroy {
            gate = gate.with(NoGlobalDestroy);
        }
        let mut plane = Floodwall::new(
            Admission::new(self.capacity, RateLimit::new(self.burst, self.refill)),
            gate,
        )
        .with_scheduler(
            SchedulerConfig::default()
                .with_conflict_window(self.window)
                .with_lease(self.lease),
        )
        .with_hold(
            HoldConfig::default()
                .with_capacity(self.hold_capacity)
                .with_ttl(self.ttl),
        );
        if self.signed {
            let keyring = AGENTS
                .iter()
                .fold(Keyring::new(), |k, a| k.with(*a, key(a).verifying_key()));
            plane = plane.with_keyring(keyring);
        }
        plane
    }
}

/// The count of `event` in `c`.
fn field<'a>(c: &'a mut Counts, event: &str) -> &'a mut u64 {
    match event {
        "unsigned" => &mut c.unsigned,
        "unknown_agent" => &mut c.unknown_agent,
        "bad_signature" => &mut c.bad_signature,
        "duplicate" => &mut c.duplicate,
        "backpressure" => &mut c.backpressure,
        "rate_limited" => &mut c.rate_limited,
        "queued" => &mut c.queued,
        "admitted" => &mut c.admitted,
        "deferred" => &mut c.deferred,
        "rejected" => &mut c.rejected,
        "released" => &mut c.released,
        "expired" => &mut c.expired,
        "succeeded" => &mut c.succeeded,
        "failed" => &mut c.failed,
        "lapsed" => &mut c.lapsed,
        _ => unreachable!("{event}"),
    }
}

/// The tally kept from the calls' results alone.
#[derive(Default)]
struct Tally {
    agents: BTreeMap<String, Counts>,
    untracked: Counts,
    peak: usize,
}

impl Tally {
    fn count(&mut self, agent: &str, event: &str) {
        *field(self.agents.entry(agent.to_string()).or_default(), event) += 1;
    }

    fn total(&self) -> Counts {
        let mut t = self.untracked;
        for c in self.agents.values() {
            for (event, n) in c.events() {
                *field(&mut t, event) += n;
            }
        }
        t
    }
}

fn refusal(why: Rejected) -> &'static str {
    match why {
        Rejected::Unsigned => "unsigned",
        Rejected::UnknownAgent => "unknown_agent",
        Rejected::BadSignature => "bad_signature",
        Rejected::Duplicate => "duplicate",
        Rejected::Backpressure => "backpressure",
        Rejected::RateLimited => "rate_limited",
    }
}

fn random_intent(rng: &mut Rng, config: &Config) -> Intent {
    let mut agent = *rng.pick(&AGENTS);
    if config.signed && rng.chance(5) {
        agent = "z"; // no key
    }
    let resource = rng.pick(&RESOURCES).to_string();
    let action = match rng.below(3) {
        0 => Action::Apply {
            resource,
            manifest: "v2".into(),
        },
        1 => Action::Scale {
            resource,
            replicas: rng.below(4) as u32,
        },
        _ => Action::Destroy { resource },
    };
    let blast = *rng.pick(&[
        BlastRadius::Cell,
        BlastRadius::Service,
        BlastRadius::Region,
        BlastRadius::Global,
    ]);
    let priority = *rng.pick(&[
        Priority::Bulk,
        Priority::Normal,
        Priority::Urgent,
        Priority::Pager,
    ]);
    // Few ids, so duplicates happen.
    let intent = Intent::new(rng.below(6), AgentId::new(agent), action, priority, blast);
    if !config.signed || rng.chance(8) {
        return intent; // unsigned
    }
    let signer = if rng.chance(8) { "b" } else { agent }; // sometimes forged
    intent.signed(&key(signer))
}

/// The plane's stats must be the tally, and its gauges what it shows.
fn check(plane: &Floodwall, tally: &Tally, seed: u64, step: usize) {
    let stats = plane.stats();
    let at = format!("seed {seed}, step {step}");
    let agents: BTreeMap<String, Counts> = stats
        .agents()
        .map(|(name, c)| (name.to_string(), *c))
        .collect();
    assert_eq!(agents, tally.agents, "{at}: per agent");
    assert_eq!(stats.total, tally.total(), "{at}: in all");
    assert_eq!(stats.untracked, tally.untracked, "{at}: untracked");
    assert_eq!(stats.queue_depth, plane.pending(), "{at}: queue depth");
    assert_eq!(stats.peak_queue_depth, tally.peak, "{at}: peak queue depth");
    assert_eq!(
        stats.in_flight,
        plane.in_flight().count(),
        "{at}: in flight"
    );
    let lease = plane.scheduler_config().lease();
    let overdue = plane
        .in_flight()
        .filter(|f| lease.is_some_and(|l| plane.clock() >= f.since.saturating_add(l.ticks())))
        .count();
    assert_eq!(stats.overdue, overdue, "{at}: overdue");
    assert_eq!(stats.held, plane.held().count(), "{at}: held");
}

/// Which events the floods produced, across all seeds.
#[derive(Default)]
struct Coverage {
    events: BTreeMap<&'static str, u64>,
    /// Refusals in the name of an agent outside the keyring.
    untracked: u64,
    /// Overdue intents, summed over the checks.
    overdue: u64,
    restarts: u64,
}

impl Coverage {
    fn add(&mut self, tally: &Tally) {
        for (event, n) in tally.total().events() {
            *self.events.entry(event).or_default() += n;
        }
        self.untracked += tally.untracked.refused();
    }
}

fn flood(seed: u64, signed: bool, cov: &mut Coverage) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let config = Config::random(&mut rng, signed);
    let mut plane = config.plane();
    let mut tally = Tally::default();
    let mut now = 0u64;
    for step in 0..160 {
        match rng.below(10) {
            0..=4 => {
                let intent = random_intent(&mut rng, &config);
                let agent = intent.agent.to_string();
                match plane.submit(intent, now) {
                    Ok(()) => tally.count(&agent, "queued"),
                    Err(why) if config.signed && !AGENTS.contains(&agent.as_str()) => {
                        *field(&mut tally.untracked, refusal(why)) += 1
                    }
                    Err(why) => tally.count(&agent, refusal(why)),
                }
            }
            5 | 6 => {
                now += rng.below(3);
                let report = plane.tick(now);
                for d in &report.decisions {
                    let event = match d.verdict {
                        Verdict::Admit => "admitted",
                        Verdict::Defer(_) => "deferred",
                        Verdict::Reject(_) => "rejected",
                    };
                    tally.count(d.intent.agent.as_str(), event);
                }
                for held in &report.expired {
                    tally.count(held.intent.agent.as_str(), "expired");
                }
                for lapsed in &report.lapsed {
                    tally.count(lapsed.intent.agent.as_str(), "lapsed");
                }
            }
            7 => {
                let held: Vec<IntentKey> = plane.held().map(|h| h.intent.key()).collect();
                if let Some(key) = held.get(rng.below(held.len().max(1) as u64) as usize) {
                    if rng.chance(60) {
                        if plane.release(key, "alice", now).is_ok() {
                            tally.count(key.agent.as_str(), "released");
                        }
                    } else if plane.expire(key, "bob", now).is_ok() {
                        tally.count(key.agent.as_str(), "expired");
                    }
                }
            }
            8 => {
                let flying: Vec<IntentKey> = plane.in_flight().map(|f| f.intent.key()).collect();
                if let Some(key) = flying.get(rng.below(flying.len().max(1) as u64) as usize) {
                    let outcome = if rng.chance(70) {
                        Outcome::Succeeded
                    } else {
                        Outcome::Failed("rolled back".into())
                    };
                    let event = if outcome == Outcome::Succeeded {
                        "succeeded"
                    } else {
                        "failed"
                    };
                    if plane.complete(key, outcome, now).is_ok() {
                        tally.count(key.agent.as_str(), event);
                    }
                }
            }
            _ => {
                if rng.chance(30) {
                    // A restart: the stats start afresh, the plane carries on.
                    let mut export = Vec::new();
                    plane.ledger().export_jsonl(&mut export).unwrap();
                    let ledger = Ledger::read_jsonl(&export[..]).unwrap();
                    plane = config.plane().resume(ledger, now).unwrap();
                    cov.add(&tally);
                    tally = Tally::default();
                    cov.restarts += 1;
                }
            }
        }
        // Only an arrival or a release adds to the queue, one at a time, so
        // the deepest it has been is the deepest seen after any call.
        tally.peak = tally.peak.max(plane.pending());
        check(&plane, &tally, seed, step);
        cov.overdue += plane.stats().overdue as u64;
    }
    cov.add(&tally);
}

#[test]
fn the_stats_are_what_the_calls_returned() {
    let mut cov = Coverage::default();
    for seed in 0..120 {
        flood(seed, false, &mut cov);
    }
    for seed in 1000..1030 {
        flood(seed, true, &mut cov);
    }
    println!(
        "{:#?} untracked {} overdue {} restarts {}",
        cov.events, cov.untracked, cov.overdue, cov.restarts
    );
    // Every event happened, many times over, and so did restarts.
    for (event, _) in Counts::default().events() {
        let n = cov.events.get(event).copied().unwrap_or(0);
        assert!(n >= 10, "{event} happened {n} times");
    }
    assert!(cov.untracked >= 10, "{}", cov.untracked);
    assert!(cov.overdue >= 10, "{}", cov.overdue);
    assert!(cov.restarts > 50, "{}", cov.restarts);
}
