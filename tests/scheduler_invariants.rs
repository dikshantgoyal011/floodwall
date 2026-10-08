//! Randomized checks of the scheduler's guarantees, through the public API.
//!
//! Each seed builds a plane with a random configuration (half of them
//! around an Admission that already has work queued and a clock that has
//! moved on), floods it with
//! random intents from several agents, ticks it, completes in-flight work
//! at random, and has a human release or expire held intents at random.
//! After every step it checks the invariants the scheduler and hold queue
//! document, against an independent model kept by this test.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use floodwall::intent::{Action, AgentId, BlastRadius, Intent, IntentKey, Priority};
use floodwall::merkle::verify_inclusion;
use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy, Policy, ResourceAllowlist};
use floodwall::sha256::sha256;
use floodwall::{audit_suffix, Keyring, Ledger, SigningKey};
use floodwall::{
    Admission, Floodwall, Gate, HoldConfig, HoldError, Outcome, RateLimit, Rejected,
    SchedulerConfig, Verdict, CONFLICT_CHECK,
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

/// A policy that changes over time: while the flag is up, changes to the
/// "queue" resource are banned. "queue" is also off the allowlist, so its
/// intents are deferred and held, and may be rejected once released.
struct QueueBan(Arc<AtomicBool>);

impl Policy for QueueBan {
    fn name(&self) -> &str {
        "queue-ban"
    }

    fn evaluate(&self, intent: &Intent) -> Verdict {
        if self.0.load(Ordering::Relaxed) && intent.action.resource() == "queue" {
            Verdict::Reject("queue changes are banned".into())
        } else {
            Verdict::Admit
        }
    }
}

const AGENTS: [&str; 4] = ["a", "b", "c", "d"];
const RESOURCES: [&str; 5] = ["web", "api", "cache", "db", "queue"];

fn random_intent(rng: &mut Rng, agent: &str, id: u64) -> Intent {
    let resource = rng.pick(&RESOURCES).to_string();
    let action = match rng.below(3) {
        0 => Action::Apply {
            resource,
            manifest: format!("v{}", rng.below(3)),
        },
        1 => Action::Scale {
            resource,
            replicas: rng.below(3) as u32,
        },
        _ => Action::Destroy { resource },
    };
    let blast = match rng.below(20) {
        0 => BlastRadius::Global,
        1..=3 => BlastRadius::Region,
        4..=10 => BlastRadius::Service,
        _ => BlastRadius::Cell,
    };
    let priority = *rng.pick(&[
        Priority::Bulk,
        Priority::Normal,
        Priority::Normal,
        Priority::Urgent,
        Priority::Pager,
    ]);
    Intent::new(id, AgentId::new(agent), action, priority, blast)
}

fn random_config(rng: &mut Rng) -> SchedulerConfig {
    let mut config = SchedulerConfig::default()
        .with_conflict_window(*rng.pick(&[0, 1, 5, 20]))
        .with_default_limit(1 + rng.below(3) as usize);
    for resource in RESOURCES {
        if rng.chance(30) {
            config = config.with_limit(resource, 1 + rng.below(4) as usize);
        }
    }
    config
}

fn is_wide(i: &Intent) -> bool {
    i.blast_radius >= BlastRadius::Region
}

/// The test's own record of who claimed what, kept independently of the
/// scheduler: (intent key, action, completion tick).
#[derive(Default)]
struct Model {
    claims: Vec<(IntentKey, Action, Option<u64>)>,
    /// Intents that are queued, in flight, or held.
    live: HashSet<IntentKey>,
    /// Intents that are held.
    held: HashSet<IntentKey>,
    /// Intents released from hold and not yet ruled on again.
    released: HashSet<IntentKey>,
    /// Ledger records the plane should have written, by kind.
    decisions: usize,
    completions: usize,
    releases: usize,
    expiries: usize,
}

impl Model {
    fn open_conflict(&self, intent: &Intent, now: u64, window: u64) -> bool {
        self.claims.iter().any(|(key, action, done)| {
            key.agent != intent.agent
                && done.is_none_or(|d| now < d.saturating_add(window))
                && action.contradicts(&intent.action)
        })
    }
}

fn check_in_flight(plane: &Floodwall, seed: u64, cov: &mut Coverage) {
    let flying: Vec<&Intent> = plane.in_flight().map(|f| &f.intent).collect();
    let config = plane.scheduler_config();
    let globals = flying
        .iter()
        .filter(|i| i.blast_radius == BlastRadius::Global)
        .count();
    if globals > 0 {
        assert_eq!(flying.len(), 1, "seed {seed}: a global shares the floor");
    }
    assert!(
        flying.iter().filter(|i| is_wide(i)).count() <= 1,
        "seed {seed}: two wide intents in flight"
    );
    let mut per_resource: HashMap<&str, Vec<&Intent>> = HashMap::new();
    for i in &flying {
        per_resource.entry(i.action.resource()).or_default().push(i);
    }
    for (resource, here) in per_resource {
        if here.iter().any(|i| i.blast_radius == BlastRadius::Region) {
            assert_eq!(here.len(), 1, "seed {seed}: a region shares {resource}");
        } else {
            if here.len() > 1 {
                cov.shared_resource_moments += 1;
            }
            assert!(
                here.len() <= config.limit_for(resource),
                "seed {seed}: {resource} over its limit"
            );
        }
        // Two agents never apply contradictory changes at the same time.
        for x in &here {
            for y in &here {
                assert!(
                    x.agent == y.agent || !x.action.contradicts(&y.action),
                    "seed {seed}: contradictory changes in flight on {resource}"
                );
            }
        }
    }
}

/// How often each situation came up across all seeds, so the test can
/// show it exercised them rather than passing vacuously.
#[derive(Debug, Default)]
struct Coverage {
    admitted: usize,
    rejected: usize,
    deferred_by_conflict: usize,
    duplicates_refused: usize,
    regions_dispatched: usize,
    globals_dispatched: usize,
    /// A blocked intent with something ruled on behind it in the same pass.
    overtaking_checks: usize,
    /// More than one narrow intent in flight on one resource at once.
    shared_resource_moments: usize,
    failures_reported: usize,
    deferred_and_held: usize,
    released: usize,
    /// A released intent admitted although something in its breakdown
    /// deferred it.
    deferrals_waived: usize,
    released_but_rejected: usize,
    expired_by_tick: usize,
    expired_by_human: usize,
    not_held_errors: usize,
    /// Intents already queued in the Admission the plane was built from.
    adopted: usize,
    /// Resubmissions refused because the key was an adopted intent's.
    adopted_duplicates_refused: usize,
    forgeries_refused: usize,
    signed_records: usize,
    suffix_audits: usize,
    inclusion_proofs: usize,
}

/// Nothing behind a blocked intent in the queue took what it waits for.
fn check_no_overtaking(
    before: &[Intent],
    ruled: &HashSet<IntentKey>,
    seed: u64,
    cov: &mut Coverage,
) {
    for (w_pos, w) in before.iter().enumerate() {
        if ruled.contains(&w.key()) {
            continue; // not blocked
        }
        for x in before[w_pos + 1..]
            .iter()
            .filter(|x| ruled.contains(&x.key()))
        {
            cov.overtaking_checks += 1;
            let overtook = match w.blast_radius {
                BlastRadius::Global => true,
                BlastRadius::Region => is_wide(x) || x.action.resource() == w.action.resource(),
                BlastRadius::Service | BlastRadius::Cell => {
                    x.action.resource() == w.action.resource()
                }
            };
            assert!(
                !overtook,
                "seed {seed}: {} overtook blocked {}",
                x.key(),
                w.key()
            );
        }
    }
}

const QUEUE_CAPACITY: usize = 64;

/// The plane's hold matches the model, and every live intent is in exactly
/// one place: queued, in flight, or held.
fn check_hold(plane: &Floodwall, model: &Model, seed: u64) {
    let held: HashSet<IntentKey> = plane.held().map(|h| h.intent.key()).collect();
    assert_eq!(held, model.held, "seed {seed}: hold differs from the model");
    let queued: HashSet<IntentKey> = plane.queued().map(Intent::key).collect();
    let flying: HashSet<IntentKey> = plane.in_flight().map(|f| f.intent.key()).collect();
    assert_eq!(
        queued.len() + flying.len() + held.len(),
        model.live.len(),
        "seed {seed}: an intent is in two places, or lost"
    );
    let all: HashSet<IntentKey> = queued.into_iter().chain(flying).chain(held).collect();
    assert_eq!(
        all, model.live,
        "seed {seed}: live intents differ from the model"
    );
    let since: Vec<u64> = plane.held().map(|h| h.since).collect();
    assert!(since.is_sorted(), "seed {seed}: hold is not oldest first");
}

/// Each agent's signing key, derived from its name.
fn key_of(agent: &str) -> SigningKey {
    SigningKey::from_seed(&sha256(format!("invariants/{agent}").as_bytes()))
}

fn run(seed: u64, cov: &mut Coverage) {
    run_with(seed, cov, false);
}

/// One flood. With `signed`, every agent signs its intents, now and then
/// one is forged in another agent's name, and the plane has a keyring.
fn run_with(seed: u64, cov: &mut Coverage, signed: bool) {
    let keys: HashMap<&str, SigningKey> = AGENTS.iter().map(|a| (*a, key_of(a))).collect();
    let keyring = AGENTS.iter().fold(Keyring::new(), |ring, a| {
        ring.with(*a, keys[a].verifying_key())
    });
    let sign = |intent: Intent| {
        if signed {
            let key = &keys[intent.agent.as_str()];
            intent.signed(key)
        } else {
            intent
        }
    };
    let mut rng = Rng::new(seed);
    let ban = Arc::new(AtomicBool::new(false));
    let gate = Gate::new()
        .with(NoGlobalDestroy)
        .with(BlastNeedsPriority)
        .with(ResourceAllowlist::new(["web", "api", "cache", "db"]))
        .with(QueueBan(Arc::clone(&ban)));
    let mut admission = Admission::new(QUEUE_CAPACITY, RateLimit::new(6.0, 2.0));
    let mut model = Model::default();
    let mut next_id: HashMap<&str, u64> = HashMap::new();
    // Half the seeds build the plane around an Admission that already has
    // work queued and has seen time pass.
    let start = if rng.chance(50) {
        1 + rng.below(500)
    } else {
        0
    };
    let mut adopted = HashSet::new();
    if start > 0 {
        admission.prune_idle(start); // advances its clock even if nothing is queued
        for _ in 0..rng.below(40) {
            let agent = *rng.pick(&AGENTS);
            let id = next_id.entry(agent).or_insert(0);
            *id += 1;
            let intent = sign(random_intent(&mut rng, agent, *id));
            let key = intent.key();
            if admission.submit(intent, start).is_ok() {
                cov.adopted += 1;
                model.live.insert(key.clone());
                adopted.insert(key);
            }
        }
    }
    let hold = HoldConfig::default()
        .with_capacity(*rng.pick(&[0, 2, 8, 1024]))
        .with_ttl(*rng.pick(&[None, Some(3), Some(15)]));
    // Every flood checkpoints its ledger at a random interval, so each run
    // ends with suffix audits. Signed floods also sign their checkpoints
    // (Ed25519 is slow in debug builds, so only those).
    let plane_key = key_of("the-plane");
    let mut ledger = Ledger::new().with_checkpoints(1 + rng.below(40));
    if signed {
        ledger = ledger.with_signer(plane_key.clone());
    }
    let mut plane = Floodwall::new(admission, gate)
        .with_scheduler(random_config(&mut rng))
        .with_hold(hold)
        .with_ledger(ledger);
    if signed {
        plane = plane.with_keyring(keyring.clone());
    }
    let window = plane.scheduler_config().conflict_window();
    assert_eq!(
        plane.clock(),
        start,
        "seed {seed}: plane did not adopt the clock"
    );
    check_hold(&plane, &model, seed); // adopted intents are live and queued

    let flood_ticks = start + 60;
    let mut now = start;
    loop {
        let flooding = now < flood_ticks;
        if rng.chance(10) {
            ban.store(!ban.load(Ordering::Relaxed), Ordering::Relaxed);
        }
        if flooding {
            for _ in 0..rng.below(6) {
                let agent = *rng.pick(&AGENTS);
                // Now and then, resubmit an id that may still be live.
                let id = if rng.chance(10) {
                    next_id.get(agent).copied().unwrap_or(0).saturating_sub(1)
                } else {
                    let id = next_id.entry(agent).or_insert(0);
                    *id += 1;
                    *id
                };
                let mut intent = sign(random_intent(&mut rng, agent, id));
                let forged = signed && rng.chance(10);
                if forged {
                    // Signed in another agent's name.
                    let other = AGENTS
                        [(AGENTS.iter().position(|a| *a == agent).unwrap() + 1) % AGENTS.len()];
                    intent = intent.signed(&keys[other]);
                }
                let key = intent.key();
                let result = plane.submit(intent, now);
                if forged {
                    assert_eq!(
                        result,
                        Err(Rejected::BadSignature),
                        "seed {seed}: forgery accepted"
                    );
                    cov.forgeries_refused += 1;
                    continue;
                }
                match result {
                    Ok(()) => assert!(model.live.insert(key), "seed {seed}: accepted a live key"),
                    Err(Rejected::Duplicate) => {
                        cov.duplicates_refused += 1;
                        if adopted.contains(&key) {
                            cov.adopted_duplicates_refused += 1;
                        }
                        assert!(model.live.contains(&key), "seed {seed}: false duplicate")
                    }
                    Err(Rejected::RateLimited | Rejected::Backpressure) => {}
                    Err(
                        e @ (Rejected::Unsigned | Rejected::UnknownAgent | Rejected::BadSignature),
                    ) => {
                        panic!("seed {seed}: genuine intent refused with {e:?}")
                    }
                }
            }
        }

        let before: Vec<Intent> = plane.queued().cloned().collect();
        let report = plane.tick(now);
        let ruled: HashSet<IntentKey> = report.decisions.iter().map(|d| d.intent.key()).collect();
        check_no_overtaking(&before, &ruled, seed, cov);

        for d in &report.decisions {
            model.decisions += 1;
            let conflict = &d.breakdown.last().expect("conflict check present");
            assert_eq!(conflict.0, CONFLICT_CHECK);
            let expected = model.open_conflict(&d.intent, now, window);
            assert_eq!(
                matches!(conflict.1, Verdict::Defer(_)),
                expected,
                "seed {seed}: conflict check disagrees with the model for {}",
                d.intent.key()
            );
            if expected {
                cov.deferred_by_conflict += 1;
            }
            match (&d.verdict, d.intent.blast_radius) {
                (Verdict::Admit, BlastRadius::Global) => cov.globals_dispatched += 1,
                (Verdict::Admit, BlastRadius::Region) => cov.regions_dispatched += 1,
                (Verdict::Reject(_), _) => cov.rejected += 1,
                _ => {}
            }
            let key = d.intent.key();
            if model.released.remove(&key) {
                assert_eq!(d.released_by.as_deref(), Some("ops"), "seed {seed}");
                assert!(
                    !matches!(d.verdict, Verdict::Defer(_)),
                    "seed {seed}: released {key} deferred again"
                );
                let had_defer = d
                    .breakdown
                    .iter()
                    .any(|(_, v)| matches!(v, Verdict::Defer(_)));
                match d.verdict {
                    Verdict::Admit if had_defer => cov.deferrals_waived += 1,
                    Verdict::Reject(_) => cov.released_but_rejected += 1,
                    _ => {}
                }
            } else {
                assert_eq!(d.released_by, None, "seed {seed}");
            }
            match d.verdict {
                Verdict::Admit => {
                    cov.admitted += 1;
                    model.claims.push((key, d.intent.action.clone(), None));
                }
                Verdict::Defer(_) => {
                    cov.deferred_and_held += 1;
                    assert!(model.held.insert(key), "seed {seed}: held twice");
                }
                Verdict::Reject(_) => {
                    model.live.remove(&key);
                }
            }
        }
        // Expired at the start of the tick, or evicted by a deferral in it.
        for held in &report.expired {
            let key = held.intent.key();
            cov.expired_by_tick += 1;
            model.expiries += 1;
            assert!(
                model.held.remove(&key),
                "seed {seed}: expired {key} was not held"
            );
            model.live.remove(&key);
        }
        check_hold(&plane, &model, seed);
        check_in_flight(&plane, seed, cov);
        // Maximal: a second pass at the same tick finds nothing new.
        assert!(
            plane.tick(now).decisions.is_empty(),
            "seed {seed}: a pass left ready work waiting"
        );

        // Complete some in-flight work (all of it once the flood is over).
        let flying: Vec<IntentKey> = plane.in_flight().map(|f| f.intent.key()).collect();
        for key in flying {
            if !flooding || rng.chance(40) {
                let outcome = if rng.chance(10) {
                    cov.failures_reported += 1;
                    Outcome::Failed("boom".into())
                } else {
                    Outcome::Succeeded
                };
                plane.complete(&key, outcome, now).unwrap();
                model.completions += 1;
                model.live.remove(&key);
                let claim = model
                    .claims
                    .iter_mut()
                    .find(|(k, _, done)| *k == key && done.is_none())
                    .expect("model has the claim");
                claim.2 = Some(now);
            }
        }
        check_in_flight(&plane, seed, cov);

        // A human works through the hold: some intents released, some
        // expired. Once the flood is over, everything held is acted on.
        let held: Vec<IntentKey> = plane.held().map(|h| h.intent.key()).collect();
        for key in held {
            let roll = rng.below(100);
            if roll < 15 || (!flooding && roll < 60) {
                match plane.release(&key, "ops", now) {
                    Ok(()) => {
                        cov.released += 1;
                        model.releases += 1;
                        model.held.remove(&key);
                        model.released.insert(key);
                    }
                    Err(HoldError::Backpressure(k)) => {
                        assert_eq!(k, key);
                        assert_eq!(plane.pending(), QUEUE_CAPACITY, "seed {seed}");
                    }
                    Err(e) => panic!("seed {seed}: {e}"),
                }
            } else if roll < 25 || !flooding {
                let dropped = plane.expire(&key, "ops", now).unwrap();
                assert_eq!(dropped.intent.key(), key);
                cov.expired_by_human += 1;
                model.expiries += 1;
                model.held.remove(&key);
                model.live.remove(&key);
            }
        }
        // Acting on something that is not held does nothing.
        let stranger = IntentKey::new("nobody", now);
        assert_eq!(
            plane.release(&stranger, "ops", now),
            Err(HoldError::NotHeld(stranger.clone()))
        );
        assert_eq!(
            plane.expire(&stranger, "ops", now),
            Err(HoldError::NotHeld(stranger))
        );
        cov.not_held_errors += 2;
        check_hold(&plane, &model, seed);

        if !flooding
            && plane.pending() == 0
            && plane.in_flight().count() == 0
            && plane.held().count() == 0
        {
            break;
        }
        // Liveness: once the flood stops, the queue (at most 64) drains.
        assert!(
            now < flood_ticks + 200,
            "seed {seed}: the queue stopped draining"
        );
        now += 1 + rng.below(2);
    }

    assert!(model.live.is_empty(), "seed {seed}: intents left live");
    assert!(
        model.released.is_empty(),
        "seed {seed}: a release never landed"
    );
    assert_eq!(
        plane.ledger().len(),
        model.decisions + model.completions + model.releases + model.expiries,
        "seed {seed}: one record per decision, completion, release and expiry"
    );
    assert!(plane.ledger().verify(), "seed {seed}: ledger chain broken");
    if signed {
        assert_eq!(
            plane.ledger().verify_signatures(&keyring),
            Ok(plane.ledger().len()),
            "seed {seed}: a record without proof of authorship"
        );
        cov.signed_records += plane.ledger().len();
    }

    // Checkpoints: signed by the plane in signed floods, and every suffix
    // between two of them audits from the earlier one alone.
    plane.checkpoint();
    let ledger = plane.ledger();
    let pk = plane_key.verifying_key();
    let key = signed.then_some(&pk);
    let cps = ledger.checkpoints();
    if signed {
        assert_eq!(
            ledger.verify_checkpoint_signatures(&pk),
            Ok(cps.len()),
            "seed {seed}: an unsigned checkpoint"
        );
    }
    for pair in cps.windows(2) {
        let suffix = &ledger.records()[pair[0].size as usize..pair[1].size as usize];
        assert_eq!(
            audit_suffix(&pair[0], &pair[1], suffix, key),
            Ok(()),
            "seed {seed}: suffix {}..{} failed its audit",
            pair[0].size,
            pair[1].size
        );
        cov.suffix_audits += 1;
    }
    let (first, last) = (&cps[0], cps.last().unwrap());
    assert_eq!(
        audit_suffix(first, last, ledger.records_after(first).unwrap(), key),
        Ok(()),
        "seed {seed}: the whole suffix failed its audit"
    );
    // A few records proven to be in the final checkpoint.
    for _ in 0..3 {
        let seq = rng.below(last.size);
        let proof = ledger.prove_inclusion(seq, last.size).unwrap();
        let digest = ledger.records()[seq as usize].digest;
        assert!(
            verify_inclusion(&digest, seq, last.size, &proof, &last.root),
            "seed {seed}: record {seq} not proven"
        );
        cov.inclusion_proofs += 1;
    }
}

#[test]
fn scheduler_invariants_hold_across_random_floods() {
    let mut cov = Coverage::default();
    for seed in 0..300 {
        run(seed, &mut cov);
    }
    eprintln!("{cov:#?}");
    // Every situation the invariants guard must actually have come up.
    assert!(cov.admitted > 1_000, "{cov:?}");
    assert!(cov.rejected > 100, "{cov:?}");
    assert!(cov.deferred_by_conflict > 100, "{cov:?}");
    assert!(cov.duplicates_refused > 100, "{cov:?}");
    assert!(cov.regions_dispatched > 100, "{cov:?}");
    assert!(cov.globals_dispatched > 10, "{cov:?}");
    assert!(cov.overtaking_checks > 1_000, "{cov:?}");
    assert!(cov.shared_resource_moments > 100, "{cov:?}");
    assert!(cov.failures_reported > 100, "{cov:?}");
    assert!(cov.deferred_and_held > 1_000, "{cov:?}");
    assert!(cov.released > 500, "{cov:?}");
    assert!(cov.deferrals_waived > 100, "{cov:?}");
    assert!(cov.released_but_rejected > 0, "{cov:?}");
    assert!(cov.expired_by_tick > 100, "{cov:?}");
    assert!(cov.expired_by_human > 100, "{cov:?}");
    assert!(cov.adopted > 1_000, "{cov:?}");
    assert!(cov.adopted_duplicates_refused > 10, "{cov:?}");
    assert!(cov.suffix_audits > 1_000, "{cov:?}");
    assert!(cov.inclusion_proofs >= 900, "{cov:?}");
}

#[test]
fn signed_floods_keep_every_record_attributable() {
    // Ed25519 is slow in debug builds, so a handful of seeds; each still
    // exercises adoption, scheduling, holds, releases and expiries.
    let mut cov = Coverage::default();
    for seed in 1000..1006 {
        run_with(seed, &mut cov, true);
    }
    eprintln!("{cov:#?}");
    assert!(cov.forgeries_refused > 10, "{cov:?}");
    assert!(cov.signed_records > 500, "{cov:?}");
    assert!(
        cov.released > 0 && cov.expired_by_tick + cov.expired_by_human > 0,
        "{cov:?}"
    );
}
