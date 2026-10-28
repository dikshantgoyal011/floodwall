//! Property: replaying the record stream reproduces the live decisions
//! (FW-403).
//!
//! Each seed builds a plane with a random configuration and floods it with
//! random intents from several agents: random ticks (some behind the
//! clock), outcomes of both kinds, releases, expiries and checkpoints, and
//! refusals at the door of every kind. Then it checks, through the public
//! API only:
//!
//! - **The ledger is the live decisions.** Every tick's report matches the
//!   records that tick wrote, one for one, at the plane's tick.
//! - **Replay reproduces them.** A newly built plane resumed from the whole
//!   ledger writes every record again, digest for digest, and ends up
//!   holding exactly what the live plane holds.
//! - **A restart changes nothing.** The same flood, stopped at random points
//!   and resumed from its ledger (an export read back, or a file closed and
//!   reopened), sometimes after a crash that cut a tick short, gives every
//!   call the same result and ends with the same ledger and the same state
//!   as the flood run straight through.
//! - **Replay catches a decision the plane would not have made.** Changing
//!   one of its decisions (the verdict, the reason, or one policy's
//!   verdict), and re-hashing the chain so the ledger still verifies, makes
//!   resuming fail at exactly that record.
//!
//! The gate's policies are deterministic, as replay requires: a policy that
//! decides differently for the same intent, like the invariant test's
//! time-switched ban, cannot be replayed (see `floodwall::replay`). Signed
//! floods are few, since Ed25519 is slow in debug builds.

use std::fs;
use std::path::{Path, PathBuf};

use floodwall::intent::{Action, AgentId, BlastRadius, Intent, IntentKey, Priority};
use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};
use floodwall::sha256::sha256;
use floodwall::{
    Admission, Floodwall, Gate, Held, HoldConfig, Keyring, Ledger, Outcome, RateLimit, Record,
    ResumeError, SchedulerConfig, SigningKey, QUEUED,
};

/// A tiny xorshift PRNG, so every seed is reproducible.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

const AGENTS: [&str; 4] = ["a", "b", "c", "d"];
const RESOURCES: [&str; 5] = ["web", "api", "cache", "db", "queue"];

fn key_of(agent: &str) -> SigningKey {
    SigningKey::from_seed(&sha256(format!("replay-property/{agent}").as_bytes()))
}

/// Everything that makes one seed's plane, so it can be built again the
/// same way after a restart.
#[derive(Clone, Debug)]
struct Config {
    capacity: usize,
    burst: f64,
    refill: f64,
    no_global_destroy: bool,
    blast_needs_priority: bool,
    allowlist: Option<Vec<&'static str>>,
    default_limit: usize,
    db_limit: Option<usize>,
    window: u64,
    hold_capacity: usize,
    ttl: Option<u64>,
    signed: bool,
    checkpoints: Option<u64>,
}

impl Config {
    fn random(rng: &mut Rng, signed: bool) -> Self {
        Self {
            capacity: *rng.pick(&[2, 8, 32, 128]),
            burst: *rng.pick(&[1.0, 2.0, 3.5, 8.0]),
            // Fractional refills make the buckets' arithmetic matter.
            refill: *rng.pick(&[0.0, 0.1, 0.3, 0.5, 1.0, 2.5]),
            no_global_destroy: rng.chance(70),
            blast_needs_priority: rng.chance(50),
            allowlist: rng.chance(60).then(|| {
                RESOURCES
                    .iter()
                    .copied()
                    .filter(|_| rng.chance(60))
                    .collect()
            }),
            default_limit: *rng.pick(&[1, 2, 3]),
            db_limit: rng.chance(40).then(|| *rng.pick(&[1, 2])),
            window: *rng.pick(&[0, 1, 5, 20]),
            hold_capacity: *rng.pick(&[0, 1, 3, 64]),
            ttl: *rng.pick(&[None, Some(0), Some(3), Some(15)]),
            signed,
            checkpoints: rng.chance(50).then(|| *rng.pick(&[1, 3, 16])),
        }
    }

    fn plane(&self) -> Floodwall {
        let mut gate = Gate::new();
        if self.no_global_destroy {
            gate = gate.with(NoGlobalDestroy);
        }
        if self.blast_needs_priority {
            gate = gate.with(BlastNeedsPriority);
        }
        if let Some(list) = &self.allowlist {
            gate = gate.with(ResourceAllowlist::new(list.iter().copied()));
        }
        let mut scheduler = SchedulerConfig::default()
            .with_default_limit(self.default_limit)
            .with_conflict_window(self.window);
        if let Some(limit) = self.db_limit {
            scheduler = scheduler.with_limit("db", limit);
        }
        let mut plane = Floodwall::new(
            Admission::new(self.capacity, RateLimit::new(self.burst, self.refill)),
            gate,
        )
        .with_scheduler(scheduler)
        .with_hold(
            HoldConfig::default()
                .with_capacity(self.hold_capacity)
                .with_ttl(self.ttl),
        );
        if self.signed {
            let keyring = AGENTS.iter().fold(Keyring::new(), |ring, a| {
                ring.with(*a, key_of(a).verifying_key())
            });
            plane = plane.with_keyring(keyring);
        }
        plane
    }

    /// `ledger`, set up as the plane's: with its checkpoints, if any.
    fn ledger(&self, ledger: Ledger) -> Ledger {
        match self.checkpoints {
            Some(every) => ledger.with_checkpoints(every),
            None => ledger,
        }
    }
}

fn random_intent(rng: &mut Rng, agent: &str, id: u64, signed: bool) -> Intent {
    let resource = rng.pick(&RESOURCES).to_string();
    let action = match rng.below(3) {
        0 => Action::Apply {
            resource,
            manifest: format!("v{}", rng.below(3)),
        },
        1 => Action::Scale {
            resource,
            replicas: rng.below(4) as u32,
        },
        _ => Action::Destroy { resource },
    };
    let priority = *rng.pick(&[
        Priority::Bulk,
        Priority::Normal,
        Priority::Urgent,
        Priority::Pager,
    ]);
    let blast = match rng.below(20) {
        0 => BlastRadius::Global,
        1..=3 => BlastRadius::Region,
        4..=9 => BlastRadius::Service,
        _ => BlastRadius::Cell,
    };
    let intent = Intent::new(id, AgentId::new(agent), action, priority, blast);
    if !signed {
        return intent;
    }
    // Now and then a forgery: signed with another agent's key.
    let signer = if rng.chance(5) {
        AGENTS[(AGENTS.iter().position(|a| *a == agent).unwrap() + 1) % AGENTS.len()]
    } else {
        agent
    };
    intent.signed(&key_of(signer))
}

/// Everything the plane shows about itself: its clock, and its queue, what
/// is in flight and what is held, as whole intents (action, priority, blast
/// radius and signature included) with when and why.
fn state(p: &Floodwall) -> String {
    let queued: Vec<&Intent> = p.queued().collect();
    let in_flight: Vec<(&Intent, u64)> = p.in_flight().map(|f| (&f.intent, f.since)).collect();
    let held: Vec<&Held> = p.held().collect();
    format!(
        "clock {}\nqueued {queued:?}\nin flight {in_flight:?}\nheld {held:?}",
        p.clock()
    )
}

fn export(l: &Ledger) -> Vec<u8> {
    let mut out = Vec::new();
    l.export_jsonl(&mut out).unwrap();
    out
}

/// A ledger rebuilt from `records` (each about an intent), with record
/// `at`, if any, changed by `change`. The chain is re-hashed to match, so
/// the result verifies.
fn rebuild(records: &[Record], at: Option<usize>, change: &dyn Fn(&mut Record)) -> Ledger {
    let mut ledger = Ledger::new();
    for (n, r) in records.iter().enumerate() {
        let mut r = r.clone();
        if at == Some(n) {
            change(&mut r);
        }
        ledger.advance_clock(r.tick);
        ledger.append_intent(
            r.intent.as_ref().expect("a plane only records intents"),
            &r.verdict,
            r.evidence.reason,
            r.evidence.policies,
        );
    }
    assert!(ledger.verify());
    ledger
}

/// When a flood restarts, and how.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Restart {
    /// After the step: the ledger is read back from its export (or, on a
    /// file, the file is closed and reopened) by a new plane.
    Clean,
    /// Right after the step's tick, a crash that kept only the tick's first
    /// record: the rest were written but never synced.
    Crash,
}

/// What a flood did, call by call, and how it ended.
#[derive(Default)]
struct Run {
    results: Vec<String>,
    clock: u64,
    export: Vec<u8>,
    state: String,
    restarts: usize,
    finished_ticks: usize,
}

/// Stop `plane` and start a new one from its ledger, at the tick the old
/// one stopped at (the latest tick this caller gave it). For a crash, the
/// ledger first loses the records after `keep`.
fn restart(
    plane: Floodwall,
    config: &Config,
    file: Option<&Path>,
    keep: Option<usize>,
) -> Floodwall {
    let now = plane.clock();
    let ledger = match (file, keep) {
        (Some(file), keep) => {
            drop(plane);
            if let Some(keep) = keep {
                // Cut the file partway through the line of record `keep`,
                // as a torn write leaves it.
                let bytes = fs::read(file).unwrap();
                let text = String::from_utf8(bytes).unwrap();
                let marker = format!("{{\"type\":\"record\",\"seq\":{keep},");
                let at = text.find(&marker).expect("the record's line");
                fs::write(file, &text.as_bytes()[..at + marker.len() / 2]).unwrap();
            }
            let ledger = Ledger::open(file).unwrap();
            assert_eq!(ledger.discarded_on_open() > 0, keep.is_some());
            config.ledger(ledger)
        }
        (None, Some(keep)) => {
            config.ledger(rebuild(&plane.ledger().records()[..keep], None, &|_| {}))
        }
        (None, None) => config.ledger(Ledger::read_jsonl(&export(plane.ledger())[..]).unwrap()),
    };
    match config.plane().resume(ledger, now) {
        Ok(p) => p,
        Err(e) => panic!("resuming: {e}"),
    }
}

/// Flood the plane for `seed`, restarting it as `restarts` says (by step).
/// With `file`, the ledger is kept there.
fn flood(seed: u64, config: &Config, restarts: &[(usize, Restart)], file: Option<&Path>) -> Run {
    let mut rng = Rng::new(seed);
    let mut run = Run::default();
    let ledger = match file {
        Some(file) => {
            let _ = fs::remove_file(file);
            Ledger::create(file).unwrap()
        }
        None => Ledger::new(),
    };
    let mut plane = config.plane().with_ledger(config.ledger(ledger));
    let restart_at = |step: usize, how: Restart| restarts.contains(&(step, how));
    let mut next_id = [0u64; AGENTS.len()];
    let mut now = 0u64;
    for step in 0..40 {
        // Arrivals, with refusals of every kind.
        for _ in 0..rng.below(8) {
            let who = rng.below(AGENTS.len() as u64) as usize;
            let id = if rng.chance(10) && next_id[who] > 0 {
                rng.below(next_id[who]) + 1 // perhaps still live: a duplicate
            } else {
                next_id[who] += 1;
                next_id[who]
            };
            let intent = random_intent(&mut rng, AGENTS[who], id, config.signed);
            let at = now.saturating_sub(rng.below(2)); // sometimes behind the clock
            run.results
                .push(format!("submit {:?}", plane.submit(intent, at)));
        }
        // A pass, whose report must be exactly what it recorded.
        if rng.chance(80) {
            let before = plane.ledger().len();
            let report = plane.tick(now);
            let written = &plane.ledger().records()[before..];
            let mut reported: Vec<String> = report
                .expired
                .iter()
                .map(|h| format!("{} expired", h.intent.key()))
                .chain(
                    report
                        .decisions
                        .iter()
                        .map(|d| format!("{} {}", d.intent.key(), d.verdict.label())),
                )
                .collect();
            let mut recorded: Vec<String> = written
                .iter()
                .map(|r| format!("{} {}", r.intent.as_ref().unwrap().key(), r.verdict))
                .collect();
            reported.sort();
            recorded.sort();
            assert_eq!(
                reported, recorded,
                "seed {seed} step {step}: report vs ledger"
            );
            assert!(written.iter().all(|r| r.tick == plane.clock()));
            run.results.push(format!("tick {reported:?}"));
            if restart_at(step, Restart::Crash) {
                let keep = (written.len() >= 2).then_some(before + 1);
                let want = state(&plane);
                let head = plane.ledger().head();
                plane = restart(plane, config, file, keep);
                assert_eq!(state(&plane), want, "seed {seed}: crash at step {step}");
                assert_eq!(
                    plane.ledger().head(),
                    head,
                    "seed {seed}: crash at step {step}"
                );
                run.restarts += 1;
                run.finished_ticks += usize::from(keep.is_some());
            }
        }
        // The caller reports back on some of what is in flight.
        let in_flight: Vec<IntentKey> = plane.in_flight().map(|f| f.intent.key()).collect();
        for key in in_flight {
            if rng.chance(40) {
                let outcome = if rng.chance(15) {
                    Outcome::Failed(format!("failed at step {step}"))
                } else {
                    Outcome::Succeeded
                };
                let result = plane.complete(&key, outcome, now).map(|i| i.key());
                run.results.push(format!("complete {result:?}"));
            }
        }
        // A human works the hold queue. One name looks like the end of a
        // release's reason, to test reading it back.
        let held: Vec<IntentKey> = plane.held().map(|h| h.intent.key()).collect();
        for key in held {
            match rng.below(10) {
                0 | 1 => {
                    let by = *rng.pick(&["alice", "bob; held since tick 1 for: x"]);
                    let result = plane.release(&key, by, now);
                    run.results.push(format!("release {result:?}"));
                }
                2 => {
                    let result = plane.expire(&key, "carol", now).map(|h| h.intent.key());
                    run.results.push(format!("expire {result:?}"));
                }
                _ => {}
            }
        }
        if rng.chance(10) {
            plane.checkpoint();
        }
        if restart_at(step, Restart::Clean) {
            let want = state(&plane);
            let head = plane.ledger().head();
            plane = restart(plane, config, file, None);
            assert_eq!(
                state(&plane),
                want,
                "seed {seed}: restart after step {step}"
            );
            assert_eq!(
                plane.ledger().head(),
                head,
                "seed {seed}: restart after step {step}"
            );
            run.restarts += 1;
        }
        now += rng.below(3);
    }
    assert!(plane.ledger().verify(), "seed {seed}");
    run.state = state(&plane);
    run.clock = plane.clock();
    run.export = export(plane.ledger());
    run
}

#[derive(Default, Debug)]
struct Coverage {
    floods: usize,
    records: usize,
    restarts: usize,
    on_files: usize,
    finished_ticks: usize,
    tampered: usize,
    queued: usize,
    admitted: usize,
    deferred: usize,
    rejected: usize,
    released: usize,
    expired: usize,
    completed: usize,
}

/// Every property, for one seed.
fn check(seed: u64, signed: bool, cov: &mut Coverage) {
    let mut rng = Rng::new(seed ^ 0x5eed);
    let config = Config::random(&mut rng, signed);

    // Straight through, and the whole ledger replayed.
    let straight = flood(seed, &config, &[], None);
    let ledger = Ledger::read_jsonl(&straight.export[..]).unwrap();
    let replayed = config
        .plane()
        .resume(
            Ledger::read_jsonl(&straight.export[..]).unwrap(),
            straight.clock,
        )
        .unwrap_or_else(|e| panic!("seed {seed}: replaying the whole ledger: {e}"));
    assert_eq!(state(&replayed), straight.state, "seed {seed}: replay");
    assert_eq!(
        replayed.ledger().head(),
        ledger.head(),
        "seed {seed}: replay"
    );

    // With restarts, clean or after a crash, in memory or on a file.
    let mut restarts: Vec<(usize, Restart)> = (0..1 + rng.below(4))
        .map(|_| {
            let how = *rng.pick(&[Restart::Clean, Restart::Crash]);
            (rng.below(40) as usize, how)
        })
        .collect();
    restarts.sort_by_key(|(at, _)| *at);
    restarts.dedup_by_key(|(at, _)| *at);
    let dir = std::env::temp_dir().join(format!("floodwall-replay-{}", std::process::id()));
    let file: Option<PathBuf> = rng
        .chance(30)
        .then(|| dir.join(format!("seed-{seed}.jsonl")));
    if file.is_some() {
        fs::create_dir_all(&dir).unwrap();
        cov.on_files += 1;
    }
    let restarted = flood(seed, &config, &restarts, file.as_deref());
    assert_eq!(
        restarted.results, straight.results,
        "seed {seed}: calls after restarts"
    );
    assert_eq!(
        restarted.state, straight.state,
        "seed {seed}: state after restarts"
    );
    let again = Ledger::read_jsonl(&restarted.export[..]).unwrap();
    assert_eq!(
        again.head(),
        ledger.head(),
        "seed {seed}: ledger after restarts"
    );
    if let Some(file) = &file {
        let reopened = Ledger::open(file).unwrap();
        assert_eq!(reopened.head(), ledger.head(), "seed {seed}: the file");
        drop(reopened);
        fs::remove_file(file).unwrap();
    }

    // One decision changed, the chain re-hashed: refused at that record.
    let records = ledger.records();
    let decisions: Vec<usize> = (0..records.len())
        .filter(|&n| matches!(records[n].verdict.as_str(), "admit" | "defer" | "reject"))
        .collect();
    if !decisions.is_empty() {
        let at = decisions[rng.below(decisions.len() as u64) as usize];
        let how = rng.below(3);
        let tampered = rebuild(records, Some(at), &|r| match how {
            0 => {
                let other = match r.verdict.as_str() {
                    "admit" => "reject",
                    "defer" => "admit",
                    _ => "defer",
                };
                r.verdict = other.into();
            }
            1 => r.evidence.reason = Some(format!("{:?}, edited", r.evidence.reason)),
            _ => match r.evidence.policies.first_mut() {
                Some((_, label)) => {
                    *label = if label == "admit" { "reject" } else { "admit" }.into()
                }
                None => r.evidence.policies.push(("added".into(), "admit".into())),
            },
        });
        match config.plane().resume(tampered, 0) {
            Err(ResumeError::Diverged { seq, .. }) => {
                assert_eq!(seq, at as u64, "seed {seed}: caught at the wrong record")
            }
            Err(e) => panic!("seed {seed}: tampering refused for the wrong reason: {e}"),
            Ok(_) => panic!("seed {seed}: a changed decision at record {at} was replayed"),
        }
        cov.tampered += 1;
    }

    cov.floods += 1;
    cov.records += records.len();
    cov.restarts += restarted.restarts;
    cov.finished_ticks += restarted.finished_ticks;
    for r in records {
        match r.verdict.as_str() {
            QUEUED => cov.queued += 1,
            "admit" => cov.admitted += 1,
            "defer" => cov.deferred += 1,
            "reject" => cov.rejected += 1,
            "released" => cov.released += 1,
            "expired" => cov.expired += 1,
            _ => cov.completed += 1,
        }
    }
}

#[test]
fn replay_reproduces_the_live_decisions() {
    let mut cov = Coverage::default();
    for seed in 0..150 {
        check(seed, false, &mut cov);
    }
    println!("{cov:#?}");
    // Every property was exercised, many times over.
    assert!(cov.restarts > 200, "{cov:?}");
    assert!(cov.finished_ticks > 30, "{cov:?}");
    assert!(cov.on_files > 25, "{cov:?}");
    assert!(cov.tampered > 100, "{cov:?}");
    for count in [
        cov.queued,
        cov.admitted,
        cov.deferred,
        cov.rejected,
        cov.released,
        cov.expired,
        cov.completed,
    ] {
        assert!(count > 100, "{cov:?}");
    }
}

#[test]
fn signed_floods_replay_too() {
    let mut cov = Coverage::default();
    for seed in 1000..1006 {
        check(seed, true, &mut cov);
    }
    assert!(cov.restarts > 0 && cov.tampered > 0, "{cov:?}");
}
