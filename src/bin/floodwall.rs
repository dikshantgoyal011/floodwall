//! `floodwall` demo.
//!
//! Simulate a flood of agent-generated changes hitting the wall and follow
//! it all the way through: admission control, the scheduler running work
//! in parallel while serializing wide changes, the policy gate and conflict
//! check, an operator working the hold queue, changes completing (or
//! failing), and the tamper-evident ledger at the end. Every agent signs
//! its intents, and the chaos monkey now and then forges one in another
//! agent's name. Deterministic and dependency-free.
//!
//! `floodwall --export DIR` also writes the ledger for auditors: the whole
//! of it (`ledger.jsonl`), the part after the second-to-last checkpoint
//! (`ledger-suffix.jsonl`), and the public keys to check it with
//! (`keys.json`). `node tools/verify-ledger.mjs` verifies them.
//!
//! `floodwall --ledger FILE` keeps the ledger on disk as the demo runs
//! (FILE must not exist yet). Halfway through the flood it stops the plane
//! and starts a new one from the file, as after a crash, and the rest of the
//! run is exactly as it would have been; at the end it reopens the file and
//! checks it from genesis. The file is the same bytes as `ledger.jsonl`,
//! with or without `--ledger`.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::process;

use floodwall::export::keys_json;
use floodwall::intent::{Action, AgentId, BlastRadius, Intent, IntentKey, Priority};
use floodwall::merkle::verify_inclusion;
use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};
use floodwall::sha256::sha256;
use floodwall::{
    audit_suffix, Admission, Floodwall, Gate, HoldConfig, Keyring, Ledger, Outcome, RateLimit,
    Rejected, SchedulerConfig, SigningKey, Verdict, CONFLICT_CHECK,
};

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

#[derive(Default)]
struct Tally {
    offered: u64,
    forged: u64,
    rate_limited: u64,
    backpressure: u64,
    admitted: u64,
    deferred: u64,
    conflicts: u64,
    rejected: u64,
    regions: u64,
    globals: u64,
    peak_in_flight: usize,
    peak_busy_resources: usize,
    released: u64,
    released_rejected: u64,
    expired_by_operator: u64,
    expired_by_plane: u64,
    succeeded: u64,
    failed: u64,
}

fn usage() -> ! {
    eprintln!("usage: floodwall [--export DIR] [--ledger FILE]");
    process::exit(2);
}

/// The `--export DIR` and `--ledger FILE` arguments, each at most once.
fn arguments() -> (Option<PathBuf>, Option<PathBuf>) {
    let (mut export, mut ledger) = (None, None);
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let slot = match flag.as_str() {
            "--export" => &mut export,
            "--ledger" => &mut ledger,
            _ => usage(),
        };
        match args.next() {
            Some(value) if slot.is_none() => *slot = Some(PathBuf::from(value)),
            _ => usage(),
        }
    }
    (export, ledger)
}

/// When `--ledger` restarts the plane from its file.
const RESTART_AT: u64 = 100;

/// The demo's plane, without its ledger. A restarted plane must be built
/// exactly the same way.
fn build_plane(keyring: &Keyring) -> Floodwall {
    // Tight per-agent limit against a deliberately oversized flood, so rate
    // limiting and backpressure both bite. The fleet may act on the core
    // services freely; touching "billing" or "ledger-db" is held for a
    // human (deferred, not rejected).
    let admission = Admission::new(512, RateLimit::new(8.0, 2.0));
    let gate = Gate::new()
        .with(NoGlobalDestroy)
        .with(BlastNeedsPriority)
        .with(ResourceAllowlist::new(["web", "api", "cache"]));
    // Two narrow changes per resource at a time, but the ledger database
    // takes one at a time. Contradictions within 5 ticks are deferred.
    let scheduler = SchedulerConfig::default()
        .with_default_limit(2)
        .with_limit("ledger-db", 1)
        .with_conflict_window(5);
    let hold = HoldConfig::default().with_capacity(64).with_ttl(Some(40));
    Floodwall::new(admission, gate)
        .with_scheduler(scheduler)
        .with_hold(hold)
        .with_keyring(keyring.clone())
}

fn main() {
    let (export_dir, ledger_file) = arguments();
    let agents = [
        "reconciler-1",
        "reconciler-2",
        "deployer",
        "autoscaler",
        "chaos-monkey",
    ];
    let resources = ["web", "api", "cache", "billing", "ledger-db"];
    // Each agent's signing key, from a fixed seed so the demo is
    // reproducible. Real agents use seeds from a secure random source.
    let keys: Vec<SigningKey> = agents
        .iter()
        .map(|a| SigningKey::from_seed(&sha256(format!("floodwall-demo/{a}").as_bytes())))
        .collect();
    // The plane's own key, for signing its checkpoints.
    let plane_key = SigningKey::from_seed(&sha256(b"floodwall-demo/plane"));
    let keyring = agents
        .iter()
        .zip(&keys)
        .fold(Keyring::new(), |ring, (a, k)| {
            ring.with(*a, k.verifying_key())
        });

    // In memory, or on disk with every decision synced before it is
    // reported.
    let ledger = match &ledger_file {
        None => Ledger::new(),
        Some(path) => {
            let dir = path.parent().filter(|d| !d.as_os_str().is_empty());
            dir.map_or(Ok(()), fs::create_dir_all)
                .map_err(floodwall::ReadError::Io)
                .and_then(|()| Ledger::create(path))
                .unwrap_or_else(|e| {
                    eprintln!("cannot create the ledger file {}: {e}", path.display());
                    process::exit(1);
                })
        }
    };
    // A signed checkpoint every 256 records, so the ledger can be audited
    // from any checkpoint without replaying it from genesis.
    let mut plane = build_plane(&keyring)
        .with_ledger(ledger.with_checkpoints(256).with_signer(plane_key.clone()));
    // What the plane held when --ledger restarted it.
    let mut restarted = None;

    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let flood_ticks = 200u64;
    let per_tick = 20u64;
    let mut t = Tally::default();
    let mut next_id = 0u64;
    // When each dispatched change finishes applying.
    let mut due: BTreeMap<u64, Vec<IntentKey>> = BTreeMap::new();

    let mut now = 0u64;
    loop {
        // With --ledger, stop the plane halfway through the flood and start a
        // new one from its file, as after a crash.
        if let (Some(path), RESTART_AT) = (&ledger_file, now) {
            let held = (
                plane.pending(),
                plane.in_flight().count(),
                plane.held().count(),
            );
            drop(plane); // closes the file
            let ledger = Ledger::open(path)
                .map(|l| l.with_checkpoints(256).with_signer(plane_key.clone()))
                .unwrap_or_else(|e| {
                    eprintln!("reopening {} failed: {e}", path.display());
                    process::exit(1);
                });
            plane = build_plane(&keyring)
                .resume(ledger, now)
                .unwrap_or_else(|e| {
                    eprintln!("restarting from {} failed: {e}", path.display());
                    process::exit(1);
                });
            let resumed = (
                plane.pending(),
                plane.in_flight().count(),
                plane.held().count(),
            );
            assert_eq!(
                resumed, held,
                "the restarted plane holds what the old one did"
            );
            restarted = Some(held);
        }

        // Changes that finish applying report back.
        let finished: Vec<IntentKey> = due.remove(&now).unwrap_or_default();
        for key in finished {
            let outcome = if rng.below(20) == 0 {
                t.failed += 1;
                Outcome::Failed("rollout health check failed".into())
            } else {
                t.succeeded += 1;
                Outcome::Succeeded
            };
            plane
                .complete(&key, outcome, now)
                .expect("dispatched earlier");
        }

        // Agents press intents against the wall.
        if now < flood_ticks {
            for _ in 0..per_tick {
                let who = rng.below(agents.len() as u64) as usize;
                let agent = AgentId::new(agents[who]);
                let resource = resources[rng.below(resources.len() as u64) as usize].to_string();
                let blast = match rng.below(20) {
                    0 => BlastRadius::Global,
                    1..=3 => BlastRadius::Region,
                    4..=9 => BlastRadius::Service,
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
                        manifest: format!("release-{}", rng.below(3)),
                    },
                    1 => Action::Scale {
                        resource,
                        replicas: 1 + rng.below(5) as u32,
                    },
                    _ => Action::Destroy { resource },
                };
                let mut intent = Intent::new(next_id, agent, action, priority, blast);
                if agents[who] == "chaos-monkey" && rng.below(10) == 0 {
                    // A forgery: claim to be the deployer, but sign with
                    // the chaos monkey's own key.
                    intent.agent = AgentId::new("deployer");
                }
                let intent = intent.signed(&keys[who]);
                next_id += 1;
                t.offered += 1;
                match plane.submit(intent, now) {
                    Ok(()) => {}
                    Err(Rejected::BadSignature) => t.forged += 1,
                    Err(Rejected::RateLimited) => t.rate_limited += 1,
                    Err(Rejected::Backpressure) => t.backpressure += 1,
                    Err(
                        e @ (Rejected::Duplicate | Rejected::Unsigned | Rejected::UnknownAgent),
                    ) => {
                        unreachable!("fresh ids, all signed by known agents: {e:?}")
                    }
                }
            }
        }

        // One scheduling pass: rule on everything that may start now.
        let report = plane.tick(now);
        for d in &report.decisions {
            if d.released_by.is_some() && matches!(d.verdict, Verdict::Reject(_)) {
                t.released_rejected += 1;
            }
            match d.verdict {
                Verdict::Admit => {
                    t.admitted += 1;
                    match d.intent.blast_radius {
                        BlastRadius::Global => t.globals += 1,
                        BlastRadius::Region => t.regions += 1,
                        _ => {}
                    }
                    let takes = 1 + rng.below(4);
                    due.entry(now + takes).or_default().push(d.intent.key());
                }
                Verdict::Defer(_) => {
                    t.deferred += 1;
                    let conflict = d
                        .breakdown
                        .iter()
                        .any(|(name, v)| name == CONFLICT_CHECK && matches!(v, Verdict::Defer(_)));
                    if conflict {
                        t.conflicts += 1;
                    }
                }
                Verdict::Reject(_) => t.rejected += 1,
            }
        }
        t.expired_by_plane += report.expired.len() as u64;
        let busy: HashSet<&str> = plane
            .in_flight()
            .map(|f| f.intent.action.resource())
            .collect();
        t.peak_in_flight = t.peak_in_flight.max(plane.in_flight().count());
        t.peak_busy_resources = t.peak_busy_resources.max(busy.len());

        // Every 10 ticks an operator works the hold queue: billing changes
        // are approved, contradictions are mostly settled in favour of the
        // change already made, and ledger-db changes are left to expire.
        if now % 10 == 9 {
            let held: Vec<(IntentKey, bool, String)> = plane
                .held()
                .map(|h| {
                    (
                        h.intent.key(),
                        h.reason.starts_with("contradicts"),
                        h.intent.action.resource().to_string(),
                    )
                })
                .collect();
            for (key, conflict, resource) in held {
                let release = if conflict {
                    rng.below(10) < 3
                } else {
                    resource == "billing"
                };
                if release {
                    if plane.release(&key, "operator", now).is_ok() {
                        t.released += 1;
                    }
                } else if conflict {
                    plane.expire(&key, "operator", now).expect("listed as held");
                    t.expired_by_operator += 1;
                }
            }
        }

        let idle = plane.pending() == 0 && plane.in_flight().count() == 0;
        if now >= flood_ticks && idle && plane.held().count() == 0 {
            break;
        }
        now += 1;
    }

    let queued = t.offered - t.forged - t.rate_limited - t.backpressure;
    let latest = plane.checkpoint();
    let ledger = plane.ledger();
    println!(
        "floodwall demo - {} intents flung at the wall over {flood_ticks} ticks, settled by tick {now}\n",
        t.offered
    );
    println!("  at the wall (signatures + admission control)");
    println!("    forged         : {} refused (bad signature)", t.forged);
    println!("    rate-limited   : {}", t.rate_limited);
    println!("    backpressure   : {}", t.backpressure);
    println!("    queued         : {queued}");
    println!();
    println!("  scheduler (what may run now)");
    println!(
        "    peak in flight : {} across {} resources",
        t.peak_in_flight, t.peak_busy_resources
    );
    println!("    region changes : {}, one at a time", t.regions);
    println!("    global changes : {}, each alone", t.globals);
    println!();
    println!("  through the gate (policies + conflict check)");
    println!("    admitted       : {}", t.admitted);
    println!(
        "    deferred       : {} ({} contradicted another agent)",
        t.deferred, t.conflicts
    );
    println!("    rejected       : {}", t.rejected);
    println!();
    println!("  hold queue (human in the loop)");
    println!(
        "    released       : {} ({} still rejected)",
        t.released, t.released_rejected
    );
    println!(
        "    expired        : {} by the operator, {} by TTL or a full hold",
        t.expired_by_operator, t.expired_by_plane
    );
    println!();
    println!("  applied (reported back)");
    println!("    succeeded      : {}", t.succeeded);
    println!("    failed         : {}", t.failed);
    println!();
    println!("  ledger (tamper-evident)");
    println!("    records        : {}", ledger.len());
    println!("    head digest    : {}", ledger.head());
    println!("    chain valid    : {}", ledger.verify());
    match ledger.verify_signatures(&keyring) {
        Ok(n) => println!("    signatures     : all {n} records signed by their agents"),
        Err(e) => println!("    signatures     : FAILED, {e}"),
    }

    // An auditor who already trusts the second-to-last checkpoint checks
    // the rest with only the records after it, and proves one record is in
    // the ledger with a handful of hashes.
    let pk = plane_key.verifying_key();
    let cps = ledger.checkpoints();
    let trusted = &cps[cps.len() - 2];
    let suffix = ledger
        .records_after(trusted)
        .expect("an earlier checkpoint");
    let audit = audit_suffix(trusted, &latest, suffix, Some(&pk));
    let seq = latest.size / 3;
    let proof = ledger
        .prove_inclusion(seq, latest.size)
        .expect("seq < size");
    let included = verify_inclusion(
        &ledger.records()[seq as usize].digest,
        seq,
        latest.size,
        &proof,
        &latest.root,
    );
    println!();
    println!("  checkpoints (audit without replaying)");
    match ledger.verify_checkpoint_signatures(&pk) {
        Ok(n) => println!("    checkpoints    : {n}, all signed by the plane"),
        Err(i) => println!("    checkpoints    : FAILED, checkpoint {i} is not signed"),
    }
    match audit {
        Ok(()) => println!(
            "    suffix audit   : records {}..{} checked from the checkpoint at {}: ok",
            trusted.size, latest.size, trusted.size
        ),
        Err(e) => println!("    suffix audit   : FAILED, {e}"),
    }
    println!(
        "    inclusion      : record {seq} proven in the latest root with {} hashes: {included}",
        proof.len()
    );

    if let Some(dir) = export_dir {
        let write = |name: &str, body: &dyn Fn(&mut BufWriter<File>) -> std::io::Result<()>| {
            let path = dir.join(name);
            let mut out = BufWriter::new(File::create(&path)?);
            body(&mut out)?;
            out.flush()
        };
        let result = fs::create_dir_all(&dir)
            .and_then(|()| write("ledger.jsonl", &|out| ledger.export_jsonl(out)))
            .and_then(|()| {
                write("ledger-suffix.jsonl", &|out| {
                    ledger.export_jsonl_from(trusted, out)
                })
            })
            .and_then(|()| {
                write("keys.json", &|out| {
                    writeln!(out, "{}", keys_json(&keyring, Some(&pk)))
                })
            });
        match result {
            Ok(()) => println!(
                "
  exported to {}: ledger.jsonl, ledger-suffix.jsonl, keys.json",
                dir.display()
            ),
            Err(e) => {
                eprintln!("export to {} failed: {e}", dir.display());
                process::exit(1);
            }
        }
    }

    if let Some(path) = ledger_file {
        // Close the file, then read it back as a restarted plane would.
        let (len, head) = (plane.ledger().len(), plane.ledger().head());
        drop(plane);
        match Ledger::open(&path) {
            Ok(reopened) if reopened.len() == len && reopened.head() == head => {
                if let Some((queued, in_flight, held)) = restarted {
                    println!(
                        "  restarted at tick {RESTART_AT} from {}: {queued} queued, \
                         {in_flight} in flight and {held} held, picked up from the file",
                        path.display()
                    );
                }
                println!(
                    "  on disk at {}: reopened and checked from genesis, {len} records, same head",
                    path.display()
                )
            }
            Ok(reopened) => {
                eprintln!(
                    "{} reopened with {} records and head {}, not {len} and {head}",
                    path.display(),
                    reopened.len(),
                    reopened.head()
                );
                process::exit(1);
            }
            Err(e) => {
                eprintln!("reopening {} failed: {e}", path.display());
                process::exit(1);
            }
        }
    }
}
