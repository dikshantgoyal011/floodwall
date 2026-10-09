//! # floodwall
//!
//! A control plane for high-volume, agent-driven DevOps.
//!
//! When a fleet of agents floods your infrastructure with changes, the
//! bottleneck stops being *authoring* changes and becomes *governing* them.
//! `floodwall` is the barrier in front of production: agents press
//! their [`Intent`]s against the wall, a throughput governor ([`Admission`])
//! decides how fast and in what order they wait, a scheduler decides when
//! each one may start, a policy [`Gate`] rules on it, and every decision is
//! written to a tamper-evident [`Ledger`].
//!
//! The pieces compose into one [`Floodwall`]:
//!
//! ```text
//!   flood of intents
//!        |
//!   [ Admission ]   per-agent rate limit + bounded priority queue (backpressure)
//!        |
//!   [ Scheduler ]   dispatch only what may run now
//!        |
//!   [   Gate    ]   deny-overrides stack of policies
//!        |
//!   [  Ledger   ]   hash-chained record of every verdict and outcome
//!        |
//!   dry ground (production)
//! ```
//!
//! An admitted intent is *in flight*: the caller applies the change, then
//! reports back with [`Floodwall::complete`].
//!
//! ```
//! use floodwall::{Admission, Floodwall, Gate, Outcome, RateLimit, Verdict};
//! use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
//! use floodwall::policy::{BlastNeedsPriority, NoGlobalDestroy};
//!
//! let admission = Admission::new(1024, RateLimit::new(8.0, 1.0));
//! let gate = Gate::new().with(NoGlobalDestroy).with(BlastNeedsPriority);
//! let mut plane = Floodwall::new(admission, gate);
//!
//! let intent = Intent::new(
//!     1,
//!     AgentId::new("reconciler-7"),
//!     Action::Scale { resource: "web".into(), replicas: 5 },
//!     Priority::Normal,
//!     BlastRadius::Service,
//! );
//! let key = intent.key();
//! plane.submit(intent, 0).unwrap();
//!
//! // One pass over the queue: the intent is ruled on and dispatched.
//! let report = plane.tick(0);
//! assert_eq!(report.decisions[0].verdict, Verdict::Admit);
//! assert_eq!(plane.in_flight().count(), 1);
//!
//! // The caller applies the change, then reports back.
//! plane.complete(&key, Outcome::Succeeded, 1).unwrap();
//! assert_eq!(plane.in_flight().count(), 0);
//! assert!(plane.ledger().verify());
//! ```

pub mod admission;
pub mod checkpoint;
pub mod ed25519;
pub mod gate;
pub mod hold;
pub mod intent;
pub mod keyring;
pub mod ledger;
pub mod merkle;
pub mod policy;
pub mod scheduler;
pub mod sha256;
pub mod sha512;

use std::collections::{HashMap, HashSet};
use std::fmt;

pub use admission::{Admission, InvalidRateLimit, RateLimit, Rejected};
pub use checkpoint::{audit_suffix, AuditError, Checkpoint};
pub use ed25519::{InvalidKey, Signature, SigningKey, VerifyingKey};
pub use gate::{Gate, GateDecision};
pub use hold::{Held, HoldConfig, HoldError};
pub use intent::{Intent, IntentKey};
pub use keyring::{AuthError, Keyring};
pub use ledger::{Digest, Evidence, Ledger, Record, SignatureError, SignatureProblem};
pub use merkle::FrontierFull;
pub use policy::{Policy, Verdict};
pub use scheduler::{InFlight, SchedulerConfig};

use hold::Hold;
use scheduler::{Readiness, Scheduler};

// Compile and run the README's examples as doctests, so they cannot drift
// from the API.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct ReadmeDoctests;

/// The name the scheduler's conflict check (see
/// [`scheduler`](crate::scheduler#conflicts)) has in a decision's breakdown.
pub const CONFLICT_CHECK: &str = "conflict-window";

/// The name the signature check has in a decision's breakdown, when the
/// plane has a [`Keyring`].
pub const SIGNATURE_CHECK: &str = "agent-signature";

/// The outcome of ruling on one intent: the intent itself, the combined
/// verdict, and the per-policy breakdown that produced it.
#[derive(Debug)]
pub struct Decision {
    /// The intent that was ruled on.
    pub intent: Intent,
    /// The combined verdict. `Admit` means the intent is now in flight.
    pub verdict: Verdict,
    /// Each policy's name and its individual verdict.
    pub breakdown: Vec<(String, Verdict)>,
    /// Who released this intent from hold, if it was released. A released
    /// intent's deferrals are waived: `verdict` is `Admit` unless something
    /// in `breakdown` rejects it.
    pub released_by: Option<String>,
}

/// Everything one [`Floodwall::tick`] did.
#[derive(Debug, Default)]
pub struct TickReport {
    /// Every intent ruled on in this tick, in the order they were ruled on.
    /// A deferred intent is held: see [`Floodwall::held`].
    pub decisions: Vec<Decision>,
    /// Held intents that expired in this tick: past their TTL, or evicted
    /// from a full hold queue.
    pub expired: Vec<Held>,
}

impl TickReport {
    /// The intents dispatched in this tick: the caller should apply each
    /// one and then call [`Floodwall::complete`].
    pub fn admitted(&self) -> impl Iterator<Item = &Intent> {
        self.decisions
            .iter()
            .filter(|d| d.verdict.is_admit())
            .map(|d| &d.intent)
    }
}

/// How applying an in-flight intent went, as reported by the caller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The change was applied.
    Succeeded,
    /// The change failed. Carries what went wrong.
    Failed(String),
}

impl Outcome {
    /// The ledger label: `succeeded` or `failed`.
    pub fn label(&self) -> &'static str {
        match self {
            Outcome::Succeeded => "succeeded",
            Outcome::Failed(_) => "failed",
        }
    }
}

/// [`Floodwall::complete`] was called for an intent that is not in flight.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotInFlight(pub IntentKey);

impl fmt::Display for NotInFlight {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "intent {} is not in flight", self.0)
    }
}

impl std::error::Error for NotInFlight {}

/// [`Floodwall::try_new`] was given an [`Admission`] that has two queued
/// intents with this key. Admission does not track identity, so this can
/// happen when intents are submitted to it directly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuplicateQueued(pub IntentKey);

impl fmt::Display for DuplicateQueued {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "intent {} is queued more than once in the admission controller",
            self.0
        )
    }
}

impl std::error::Error for DuplicateQueued {}

/// The control plane: admission control and a scheduler in front of a
/// policy gate, with every decision recorded in a tamper-evident ledger.
///
/// # Time
///
/// Every method that takes a `now` shares one clock, the latest tick any
/// call has supplied ([`Floodwall::clock`]). A `now` earlier than the clock
/// is treated as the clock, so time never moves backwards.
pub struct Floodwall {
    admission: Admission,
    scheduler: Scheduler,
    gate: Gate,
    ledger: Ledger,
    hold: Hold,
    /// Intents released from hold and back in the queue, with who released
    /// them. Their deferrals are waived when they are next ruled on.
    released: HashMap<IntentKey, String>,
    /// Every intent that is queued, in flight, or held. An intent key can
    /// only be live once, so a resubmitted duplicate is refused.
    live: HashSet<IntentKey>,
    /// With a keyring, every intent must be signed by its agent's key.
    keyring: Option<Keyring>,
    /// Live intents already checked against the current keyring.
    authenticated: HashSet<IntentKey>,
    clock: u64,
}

impl Floodwall {
    /// Assemble a control plane from an admission controller and a gate.
    ///
    /// The controller may already hold queued intents: the plane adopts
    /// them as they are. They become live, so their keys are refused as
    /// duplicates, and the next [`Floodwall::tick`] rules on them like any
    /// other. The plane's clock starts at the controller's
    /// ([`Admission::clock`]).
    ///
    /// # Panics
    ///
    /// Panics if the controller has two queued intents with the same
    /// [`IntentKey`]; [`Floodwall::try_new`] returns an error instead.
    pub fn new(admission: Admission, gate: Gate) -> Self {
        match Self::try_new(admission, gate) {
            Ok(plane) => plane,
            Err(e) => panic!("{e}"),
        }
    }

    /// Like [`Floodwall::new`], but returns [`DuplicateQueued`] if the
    /// controller has two queued intents with the same [`IntentKey`]. The
    /// plane tracks every intent by its key, so it cannot adopt both.
    pub fn try_new(admission: Admission, gate: Gate) -> Result<Self, DuplicateQueued> {
        let mut live = HashSet::with_capacity(admission.len());
        for intent in admission.waiting() {
            let key = intent.key();
            if live.contains(&key) {
                return Err(DuplicateQueued(key));
            }
            live.insert(key);
        }
        Ok(Self {
            clock: admission.clock(),
            admission,
            scheduler: Scheduler::new(SchedulerConfig::default()),
            gate,
            ledger: Ledger::new(),
            hold: Hold::new(HoldConfig::default()),
            released: HashMap::new(),
            live,
            keyring: None,
            authenticated: HashSet::new(),
        })
    }

    /// Require every intent to be signed by its agent's key on `keyring`
    /// (see [`Intent`](crate::Intent#signing)). [`Floodwall::submit`]
    /// refuses an unsigned or badly signed intent, or one from an agent
    /// with no key, before it touches the queue or the agent's rate limit.
    /// An intent that reached the queue another way (adopted from a
    /// populated [`Admission`], or queued before the keyring changed) is
    /// checked when it is ruled on, and rejected if it fails; the check
    /// shows in the breakdown as [`SIGNATURE_CHECK`]. Ledger records carry
    /// each intent's signature, so [`Ledger::verify_signatures`] can prove
    /// authorship later.
    pub fn with_keyring(mut self, keyring: Keyring) -> Self {
        self.keyring = Some(keyring);
        self.authenticated.clear();
        self
    }

    /// The keyring in use, if signatures are required.
    pub fn keyring(&self) -> Option<&Keyring> {
        self.keyring.as_ref()
    }

    /// Use `config` for the hold queue. A lower capacity or TTL takes
    /// effect at the next [`Floodwall::tick`].
    pub fn with_hold(mut self, config: HoldConfig) -> Self {
        self.hold.set_config(config);
        self
    }

    /// The hold queue configuration in use.
    pub fn hold_config(&self) -> &HoldConfig {
        self.hold.config()
    }

    /// Use `config` for scheduling. It applies from the next check on.
    pub fn with_scheduler(mut self, config: SchedulerConfig) -> Self {
        self.scheduler.set_config(config);
        self
    }

    /// The scheduling configuration in use.
    pub fn scheduler_config(&self) -> &SchedulerConfig {
        self.scheduler.config()
    }

    fn advance(&mut self, now: u64) -> u64 {
        self.clock = self.clock.max(now);
        self.clock
    }

    /// The latest tick any call has supplied.
    pub fn clock(&self) -> u64 {
        self.clock
    }

    /// Offer an intent to the wall at logical time `now`.
    ///
    /// With a keyring, an intent that is not signed by its agent's key is
    /// refused first, with [`Rejected::Unsigned`], [`Rejected::UnknownAgent`]
    /// or [`Rejected::BadSignature`]: an unauthenticated caller learns
    /// nothing about the queue and cannot spend an agent's rate allowance.
    /// Then an intent whose [`IntentKey`] is already queued, in flight or
    /// held is refused with [`Rejected::Duplicate`], before the rate limit
    /// is touched. Last, admission may refuse it with
    /// [`Rejected::Backpressure`] or [`Rejected::RateLimited`].
    pub fn submit(&mut self, intent: Intent, now: u64) -> Result<(), Rejected> {
        let now = self.advance(now);
        if let Some(keyring) = &self.keyring {
            keyring.authenticate(&intent).map_err(|e| match e {
                AuthError::Unsigned => Rejected::Unsigned,
                AuthError::UnknownAgent => Rejected::UnknownAgent,
                AuthError::BadSignature => Rejected::BadSignature,
            })?;
        }
        let key = intent.key();
        if self.live.contains(&key) {
            return Err(Rejected::Duplicate);
        }
        self.admission.submit(intent, now)?;
        if self.keyring.is_some() {
            self.authenticated.insert(key.clone());
        }
        self.live.insert(key);
        Ok(())
    }

    /// Stop tracking an intent that is done: rejected, completed or expired.
    fn forget(&mut self, key: &IntentKey) {
        self.live.remove(key);
        self.authenticated.remove(key);
    }

    /// One scheduling pass at logical time `now`: first expire held
    /// intents past their TTL or over the hold's capacity, then walk the
    /// queue in priority order and rule on every intent that may start now.
    /// Everything is recorded in the ledger. Admitted intents are
    /// dispatched: apply them, then call [`Floodwall::complete`]. Deferred
    /// intents are held: see [`Floodwall::release`].
    pub fn tick(&mut self, now: u64) -> TickReport {
        let now = self.advance(now);
        let mut report = TickReport::default();
        if let Some(ttl) = self.hold.config().ttl() {
            for held in self.hold.expire_due(now) {
                let reason = format!(
                    "held since tick {} for {} ticks, reaching the hold TTL of {ttl}",
                    held.since,
                    now - held.since
                );
                self.expire_held(held, reason, &mut report);
            }
        }
        self.trim_hold(&mut report);
        let mut pass = self.scheduler.begin(now);
        for position in self.admission.queued_keys() {
            if pass.is_closed() {
                break;
            }
            let intent = self
                .admission
                .get(&position)
                .expect("positions in the snapshot are only taken below");
            let mut readiness = self.scheduler.readiness(intent, &pass);
            // A released intent's conflict deferral is waived, but it never
            // runs alongside a contradictory change: it waits for it.
            if readiness == Readiness::Ready
                && self.released.contains_key(&intent.key())
                && self.scheduler.contradicts_in_flight(intent)
            {
                readiness = Readiness::Blocked;
            }
            match readiness {
                Readiness::Blocked => self.scheduler.wait(intent, &mut pass),
                Readiness::Ready => {
                    let intent = self
                        .admission
                        .take(&position)
                        .expect("the position was just read");
                    self.decide(intent, now, &mut report);
                }
            }
        }
        report
    }

    /// Rule on an intent that may start now, record the decision, and act
    /// on it: dispatch it if admitted, hold it if deferred.
    ///
    /// The verdict is the gate's policies plus the scheduler's conflict
    /// check, combined deny-overrides; the conflict check appears in the
    /// breakdown as [`CONFLICT_CHECK`]. For an intent a human released from
    /// hold, deferrals are waived and only rejections count.
    fn decide(&mut self, intent: Intent, now: u64, report: &mut TickReport) {
        let key = intent.key();
        let GateDecision { mut breakdown, .. } = self.gate.evaluate(&intent);
        if let Some(keyring) = &self.keyring {
            let signature = if self.authenticated.contains(&key) {
                Verdict::Admit
            } else {
                match keyring.authenticate(&intent) {
                    Ok(()) => {
                        self.authenticated.insert(key.clone());
                        Verdict::Admit
                    }
                    Err(e) => Verdict::Reject(e.to_string()),
                }
            };
            breakdown.push((SIGNATURE_CHECK.to_string(), signature));
        }
        let conflict = match self.scheduler.conflict(&intent, now) {
            Some(reason) => Verdict::Defer(reason),
            None => Verdict::Admit,
        };
        breakdown.push((CONFLICT_CHECK.to_string(), conflict));
        let released_by = self.released.remove(&key);
        let waive = released_by.is_some();
        let verdict = breakdown
            .iter()
            .map(|(_, verdict)| verdict)
            .filter(|verdict| !(waive && matches!(verdict, Verdict::Defer(_))))
            .fold(Verdict::Admit, |acc, verdict| acc.harsher(verdict.clone()));
        let reason = match &released_by {
            None => verdict.reason().map(str::to_string),
            Some(by) => Some(released_reason(by, &verdict, &breakdown)),
        };

        let policies = breakdown
            .iter()
            .map(|(name, verdict)| (name.clone(), verdict.label().to_string()))
            .collect();
        self.record(&intent, verdict.label(), reason, policies);
        match &verdict {
            Verdict::Admit => self.scheduler.start(intent.clone(), now),
            Verdict::Defer(why) => {
                let evicted = self.hold.put(intent.clone(), why.clone(), now);
                self.expire_evicted(evicted, report);
            }
            Verdict::Reject(_) => {
                self.forget(&key);
            }
        }
        report.decisions.push(Decision {
            intent,
            verdict,
            breakdown,
            released_by,
        });
    }

    /// Evict held intents over the hold's capacity, oldest first.
    fn trim_hold(&mut self, report: &mut TickReport) {
        let evicted = self.hold.trim();
        self.expire_evicted(evicted, report);
    }

    fn expire_evicted(&mut self, evicted: Vec<Held>, report: &mut TickReport) {
        let capacity = self.hold.config().capacity();
        for held in evicted {
            let reason = format!("evicted: the hold queue is full (capacity {capacity})");
            self.expire_held(held, reason, report);
        }
    }

    /// Record a held intent's expiry and forget it.
    fn expire_held(&mut self, held: Held, reason: String, report: &mut TickReport) {
        self.forget(&held.intent.key());
        self.record(&held.intent, "expired", Some(reason), Vec::new());
        report.expired.push(held);
    }

    /// Send a held intent back to the queue at logical time `now`, on the
    /// authority of `by` (recorded in the ledger). When it is next ruled
    /// on, its deferrals are waived: it is admitted unless a policy rejects
    /// it. It still waits its turn like any other intent, and does not use
    /// its agent's rate limit.
    ///
    /// Fails with [`HoldError::NotHeld`] if the intent is not held, and with
    /// [`HoldError::Backpressure`] if the queue is full, in which case it
    /// stays held.
    pub fn release(&mut self, key: &IntentKey, by: &str, now: u64) -> Result<(), HoldError> {
        let now = self.advance(now);
        if !self.hold.contains(key) {
            return Err(HoldError::NotHeld(key.clone()));
        }
        if self.admission.is_full() {
            return Err(HoldError::Backpressure(key.clone()));
        }
        let held = self.hold.take(key).expect("checked above");
        let reason = format!(
            "released by {by}; held since tick {} for: {}",
            held.since, held.reason
        );
        self.record(&held.intent, "released", Some(reason), Vec::new());
        self.admission
            .requeue(held.intent, now)
            .expect("checked the queue has room above");
        self.released.insert(key.clone(), by.to_string());
        Ok(())
    }

    /// Drop a held intent at logical time `now`, on the authority of `by`
    /// (recorded in the ledger), and return it. Its key may then be
    /// submitted again.
    pub fn expire(&mut self, key: &IntentKey, by: &str, now: u64) -> Result<Held, HoldError> {
        self.advance(now);
        let held = self
            .hold
            .take(key)
            .ok_or_else(|| HoldError::NotHeld(key.clone()))?;
        self.forget(key);
        self.record(
            &held.intent,
            "expired",
            Some(format!("expired by {by}")),
            Vec::new(),
        );
        Ok(held)
    }

    /// Report that applying an in-flight intent finished at logical time
    /// `now`. Frees its place in the scheduler, records the outcome in the
    /// ledger, and returns the intent.
    pub fn complete(
        &mut self,
        key: &IntentKey,
        outcome: Outcome,
        now: u64,
    ) -> Result<Intent, NotInFlight> {
        let now = self.advance(now);
        let finished = self
            .scheduler
            .finish(key, now)
            .ok_or_else(|| NotInFlight(key.clone()))?;
        self.forget(key);
        let reason = match &outcome {
            Outcome::Succeeded => None,
            Outcome::Failed(why) => Some(why.clone()),
        };
        self.record(&finished.intent, outcome.label(), reason, Vec::new());
        Ok(finished.intent)
    }

    fn record(
        &mut self,
        intent: &Intent,
        label: &str,
        reason: Option<String>,
        policies: Vec<(String, String)>,
    ) {
        self.ledger.append_intent(intent, label, reason, policies);
    }

    /// How many intents are waiting at the wall.
    pub fn pending(&self) -> usize {
        self.admission.len()
    }

    /// The waiting intents, in the order a pass considers them.
    pub fn queued(&self) -> impl Iterator<Item = &Intent> {
        self.admission.waiting()
    }

    /// The intents dispatched and not yet completed, ordered by key.
    pub fn in_flight(&self) -> impl Iterator<Item = &InFlight> {
        self.scheduler.in_flight()
    }

    /// The held (deferred) intents, oldest first.
    pub fn held(&self) -> impl Iterator<Item = &Held> {
        self.hold.iter()
    }

    /// Whether the intent `key` is held.
    pub fn is_held(&self, key: &IntentKey) -> bool {
        self.hold.contains(key)
    }

    /// Whether the intent `key` is in flight.
    pub fn is_in_flight(&self, key: &IntentKey) -> bool {
        self.scheduler.is_in_flight(key)
    }

    /// The decision ledger.
    pub fn ledger(&self) -> &Ledger {
        &self.ledger
    }

    /// Record decisions in `ledger`, set up with checkpoints and a signer
    /// as needed (see [`Ledger::with_checkpoints`] and
    /// [`Ledger::with_signer`]).
    ///
    /// # Panics
    ///
    /// Panics if `ledger` already has records, or this plane has already
    /// recorded something: a ledger is one plane's history from the start.
    pub fn with_ledger(mut self, ledger: Ledger) -> Self {
        assert!(
            ledger.is_empty() && self.ledger.is_empty(),
            "with_ledger needs an empty ledger and a plane that has not recorded anything"
        );
        self.ledger = ledger;
        self
    }

    /// Cut a checkpoint of the ledger now, unless the latest one already
    /// covers every record, and return it.
    pub fn checkpoint(&mut self) -> Checkpoint {
        self.ledger.checkpoint()
    }
}

/// The ledger reason for a decision on a released intent: who released
/// it, and which deferrals that overrode, or the rejection that still
/// stood.
fn released_reason(by: &str, verdict: &Verdict, breakdown: &[(String, Verdict)]) -> String {
    match verdict {
        Verdict::Reject(why) => format!("released by {by}, but still rejected: {why}"),
        _ => {
            let waived: Vec<&str> = breakdown
                .iter()
                .filter_map(|(_, v)| match v {
                    Verdict::Defer(why) => Some(why.as_str()),
                    _ => None,
                })
                .collect();
            if waived.is_empty() {
                format!("released by {by}")
            } else {
                format!("released by {by}, overriding: {}", waived.join("; "))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, AgentId, BlastRadius, Intent, Priority};
    use crate::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};

    fn plane() -> Floodwall {
        let admission = Admission::new(1024, RateLimit::new(64.0, 4.0));
        let gate = Gate::new()
            .with(NoGlobalDestroy)
            .with(BlastNeedsPriority)
            .with(ResourceAllowlist::new(["web", "api"]));
        Floodwall::new(admission, gate)
    }

    fn intent(id: u64, action: Action, priority: Priority, blast: BlastRadius) -> Intent {
        Intent::new(id, AgentId::new("bot"), action, priority, blast)
    }

    fn scale(id: u64, resource: &str) -> Intent {
        intent(
            id,
            Action::Scale {
                resource: resource.into(),
                replicas: 3,
            },
            Priority::Normal,
            BlastRadius::Service,
        )
    }

    #[test]
    fn admitted_change_flows_through_and_is_recorded() {
        let mut p = plane();
        p.submit(scale(1, "web"), 0).unwrap();
        assert_eq!(p.pending(), 1);
        let report = p.tick(0);
        assert_eq!(report.decisions.len(), 1);
        assert_eq!(report.decisions[0].verdict, Verdict::Admit);
        assert_eq!(p.pending(), 0);
        assert_eq!(p.ledger().len(), 1);
        assert!(p.ledger().verify());
    }

    #[test]
    fn destructive_global_is_rejected_but_still_recorded() {
        let mut p = plane();
        p.submit(
            intent(
                2,
                Action::Destroy {
                    resource: "web".into(),
                },
                Priority::Pager,
                BlastRadius::Global,
            ),
            0,
        )
        .unwrap();
        let report = p.tick(0);
        assert!(matches!(report.decisions[0].verdict, Verdict::Reject(_)));
        assert_eq!(report.admitted().count(), 0);
        // Even rejected decisions are written to the ledger.
        assert_eq!(p.ledger().len(), 1);
        let record = &p.ledger().records()[0];
        assert_eq!(record.verdict, "reject");
        // The record says what the change was and why it was stopped.
        assert_eq!(record.evidence.action, "destroy web");
        assert_eq!(
            record.evidence.reason.as_deref(),
            Some("destructive global change requires human sign-off")
        );
        assert_eq!(
            record.evidence.policies,
            vec![
                ("no-global-destroy".to_string(), "reject".to_string()),
                ("blast-needs-priority".to_string(), "admit".to_string()),
                ("resource-allowlist".to_string(), "admit".to_string()),
                (CONFLICT_CHECK.to_string(), "admit".to_string()),
            ]
        );
        // A rejected intent is not in flight.
        assert_eq!(p.in_flight().count(), 0);
        assert!(p.ledger().verify());
    }

    #[test]
    fn tick_on_empty_plane_decides_nothing() {
        let mut p = plane();
        assert!(p.tick(0).decisions.is_empty());
    }

    #[test]
    fn admitted_intents_stay_in_flight_until_completed() {
        let mut p = plane();
        let key = scale(1, "web").key();
        p.submit(scale(1, "web"), 0).unwrap();
        let report = p.tick(0);
        let admitted: Vec<IntentKey> = report.admitted().map(Intent::key).collect();
        assert_eq!(admitted.len(), 1);
        assert_eq!(admitted[0], key);
        assert!(p.is_in_flight(&key));
        let flying: Vec<_> = p.in_flight().collect();
        assert_eq!(flying.len(), 1);
        assert_eq!(flying[0].since, 0);

        let done = p.complete(&key, Outcome::Succeeded, 3).unwrap();
        assert_eq!(done.key(), key);
        assert!(!p.is_in_flight(&key));
        let last = p.ledger().records().last().unwrap();
        assert_eq!(last.verdict, "succeeded");
        assert_eq!(last.evidence.reason, None);
        assert!(p.ledger().verify());
    }

    #[test]
    fn a_failed_outcome_is_recorded_with_its_reason() {
        let mut p = plane();
        let key = scale(1, "web").key();
        p.submit(scale(1, "web"), 0).unwrap();
        p.tick(0);
        p.complete(&key, Outcome::Failed("rollout timed out".into()), 2)
            .unwrap();
        let last = p.ledger().records().last().unwrap();
        assert_eq!(last.verdict, "failed");
        assert_eq!(last.evidence.reason.as_deref(), Some("rollout timed out"));
        assert_eq!(last.evidence.action, "scale web to 3");
    }

    #[test]
    fn completing_something_not_in_flight_is_an_error() {
        let mut p = plane();
        let key = IntentKey::new("bot", 9);
        assert_eq!(
            p.complete(&key, Outcome::Succeeded, 0),
            Err(NotInFlight(key.clone()))
        );
        // Queued but not yet dispatched is not in flight either.
        p.submit(scale(9, "web"), 0).unwrap();
        assert_eq!(
            p.complete(&key, Outcome::Succeeded, 0),
            Err(NotInFlight(key.clone()))
        );
        // Completing twice fails the second time, and records nothing.
        p.tick(0);
        p.complete(&key, Outcome::Succeeded, 1).unwrap();
        let records = p.ledger().len();
        assert_eq!(
            p.complete(&key, Outcome::Succeeded, 1),
            Err(NotInFlight(key.clone()))
        );
        assert_eq!(p.ledger().len(), records);
        assert_eq!(
            NotInFlight(key).to_string(),
            "intent bot#9 is not in flight"
        );
    }

    #[test]
    fn a_live_intent_key_cannot_be_submitted_twice() {
        let mut p = plane();
        p.submit(scale(1, "web"), 0).unwrap();
        // Queued: duplicate.
        assert_eq!(p.submit(scale(1, "api"), 0), Err(Rejected::Duplicate));
        // Same id from another agent is a different intent.
        let other = Intent::new(
            1,
            AgentId::new("other-bot"),
            Action::Destroy {
                resource: "api".into(),
            },
            Priority::Normal,
            BlastRadius::Cell,
        );
        assert_eq!(p.submit(other, 0), Ok(()));
        // In flight: still a duplicate.
        p.tick(0);
        assert!(p.is_in_flight(&IntentKey::new("bot", 1)));
        assert_eq!(p.submit(scale(1, "web"), 1), Err(Rejected::Duplicate));
        // Once complete, the key may be reused.
        p.complete(&IntentKey::new("bot", 1), Outcome::Succeeded, 2)
            .unwrap();
        assert_eq!(p.submit(scale(1, "web"), 2), Ok(()));
    }

    #[test]
    fn a_rejected_intent_key_may_be_resubmitted() {
        let mut p = plane();
        let doomed = intent(
            5,
            Action::Destroy {
                resource: "web".into(),
            },
            Priority::Pager,
            BlastRadius::Global,
        );
        p.submit(doomed.clone(), 0).unwrap();
        assert!(matches!(p.tick(0).decisions[0].verdict, Verdict::Reject(_)));
        assert_eq!(p.submit(doomed, 1), Ok(()));
    }

    #[test]
    fn duplicates_do_not_spend_the_rate_limit() {
        let admission = Admission::new(1024, RateLimit::new(1.0, 0.0));
        let mut p = Floodwall::new(admission, Gate::new());
        p.submit(scale(1, "web"), 0).unwrap();
        assert_eq!(p.submit(scale(1, "web"), 0), Err(Rejected::Duplicate));
        // The duplicate did not take a token; there were none left anyway,
        // so a fresh intent is rate-limited, not refused as a duplicate.
        assert_eq!(p.submit(scale(2, "web"), 0), Err(Rejected::RateLimited));
    }

    #[test]
    fn one_tick_rules_on_everything_ready_in_priority_order() {
        let mut p = plane();
        let mut bulk = scale(1, "web");
        bulk.priority = Priority::Bulk;
        bulk.blast_radius = BlastRadius::Cell;
        let mut urgent = scale(2, "api");
        urgent.priority = Priority::Urgent;
        p.submit(bulk, 0).unwrap();
        p.submit(urgent, 0).unwrap();
        let ids: Vec<u64> = p.tick(0).decisions.iter().map(|d| d.intent.id).collect();
        assert_eq!(ids, [2, 1]);
    }

    fn global_apply(id: u64, resource: &str) -> Intent {
        intent(
            id,
            Action::Apply {
                resource: resource.into(),
                manifest: "m".into(),
            },
            Priority::Pager,
            BlastRadius::Global,
        )
    }

    #[test]
    fn a_blocked_intent_is_not_ruled_on_until_it_can_start() {
        let mut p = plane();
        p.submit(scale(1, "web"), 0).unwrap();
        p.tick(0);
        p.submit(global_apply(2, "api"), 1).unwrap();
        let records = p.ledger().len();
        // The global change waits for web: no decision, nothing recorded.
        assert!(p.tick(1).decisions.is_empty());
        assert_eq!(p.ledger().len(), records);
        assert_eq!(p.pending(), 1);
        p.complete(&IntentKey::new("bot", 1), Outcome::Succeeded, 2)
            .unwrap();
        let report = p.tick(2);
        assert_eq!(report.admitted().count(), 1);
        assert!(p.is_in_flight(&IntentKey::new("bot", 2)));
    }

    #[test]
    fn a_wide_intent_the_gate_refuses_holds_nothing() {
        let mut p = plane();
        // Rejected by no-global-destroy, so it never starts...
        p.submit(
            intent(
                1,
                Action::Destroy {
                    resource: "web".into(),
                },
                Priority::Pager,
                BlastRadius::Global,
            ),
            0,
        )
        .unwrap();
        p.submit(scale(2, "api"), 0).unwrap();
        // ...and the change behind it is ruled on in the same pass.
        let verdicts: Vec<&str> = p
            .tick(0)
            .decisions
            .iter()
            .map(|d| d.verdict.label())
            .collect();
        assert_eq!(verdicts, ["reject", "admit"]);
    }

    #[test]
    fn a_resource_lane_takes_the_highest_priority_waiter_first() {
        let mut p = plane();
        p.submit(scale(1, "web"), 0).unwrap();
        p.tick(0);
        // Two more for web: an older normal one, then a newer urgent one.
        p.submit(scale(2, "web"), 1).unwrap();
        let mut urgent = scale(3, "web");
        urgent.priority = Priority::Urgent;
        p.submit(urgent, 1).unwrap();
        assert!(p.tick(1).decisions.is_empty(), "web is busy");
        p.complete(&IntentKey::new("bot", 1), Outcome::Succeeded, 2)
            .unwrap();
        let ids: Vec<u64> = p.tick(2).decisions.iter().map(|d| d.intent.id).collect();
        assert_eq!(ids, [3]);
        p.complete(&IntentKey::new("bot", 3), Outcome::Succeeded, 3)
            .unwrap();
        let ids: Vec<u64> = p.tick(3).decisions.iter().map(|d| d.intent.id).collect();
        assert_eq!(ids, [2]);
    }

    #[test]
    fn a_refused_intent_does_not_take_its_resource_lane() {
        let mut p = plane();
        // "cache" is off the allowlist, so the gate defers it...
        p.submit(scale(1, "cache"), 0).unwrap();
        p.submit(scale(2, "cache"), 0).unwrap();
        // ...and the lane is free for the next one in the same pass.
        let verdicts: Vec<&str> = p
            .tick(0)
            .decisions
            .iter()
            .map(|d| d.verdict.label())
            .collect();
        assert_eq!(verdicts, ["defer", "defer"]);
        assert_eq!(p.in_flight().count(), 0);
    }

    fn scale_by(agent: &str, id: u64, resource: &str, replicas: u32) -> Intent {
        Intent::new(
            id,
            AgentId::new(agent),
            Action::Scale {
                resource: resource.into(),
                replicas,
            },
            Priority::Normal,
            BlastRadius::Service,
        )
    }

    fn verdicts(report: &TickReport) -> Vec<&'static str> {
        report.decisions.iter().map(|d| d.verdict.label()).collect()
    }

    #[test]
    fn contradictory_changes_from_two_agents_are_deferred() {
        let mut p = plane().with_scheduler(SchedulerConfig::default().with_conflict_window(10));
        p.submit(scale_by("a", 1, "web", 3), 0).unwrap();
        p.submit(scale_by("b", 1, "web", 8), 0).unwrap();
        // a goes first; b waits for the web lane.
        assert_eq!(verdicts(&p.tick(0)), ["admit"]);
        p.complete(&IntentKey::new("a", 1), Outcome::Succeeded, 2)
            .unwrap();
        // When b's turn comes, a's change is still within the window.
        let report = p.tick(3);
        assert_eq!(verdicts(&report), ["defer"]);
        let d = &report.decisions[0];
        assert_eq!(
            d.verdict.reason(),
            Some(
                "contradicts `scale web to 3` by a#1, completed at tick 2; conflict window open until tick 12"
            )
        );
        assert_eq!(d.breakdown.last().unwrap().0, CONFLICT_CHECK);
        let record = p.ledger().records().last().unwrap();
        assert_eq!(record.verdict, "defer");
        assert_eq!(
            record.evidence.policies.last(),
            Some(&(CONFLICT_CHECK.to_string(), "defer".to_string()))
        );
        // b#1 is held, so it cannot be resubmitted as is...
        assert!(p.is_held(&IntentKey::new("b", 1)));
        assert_eq!(
            p.submit(scale_by("b", 1, "web", 8), 12),
            Err(Rejected::Duplicate)
        );
        // ...but once the window has closed, a fresh intent goes through.
        p.submit(scale_by("b", 2, "web", 8), 12).unwrap();
        assert_eq!(verdicts(&p.tick(12)), ["admit"]);
    }

    #[test]
    fn agreeing_and_own_follow_up_changes_are_not_conflicts() {
        let mut p = plane();
        p.submit(scale_by("a", 1, "web", 3), 0).unwrap();
        p.tick(0);
        p.complete(&IntentKey::new("a", 1), Outcome::Succeeded, 1)
            .unwrap();
        // b agrees with a; a changes its own mind.
        p.submit(scale_by("b", 1, "web", 3), 1).unwrap();
        assert_eq!(verdicts(&p.tick(1)), ["admit"]);
        p.complete(&IntentKey::new("b", 1), Outcome::Succeeded, 2)
            .unwrap();
        p.submit(scale_by("a", 2, "web", 7), 2).unwrap();
        // b's claim (scale to 3) contradicts a's new target, so now a is
        // the one deferred: the window cuts both ways between agents.
        assert_eq!(verdicts(&p.tick(2)), ["defer"]);
    }

    #[test]
    fn a_policy_reject_beats_a_conflict() {
        let mut p = plane();
        p.submit(scale_by("a", 1, "web", 3), 0).unwrap();
        p.tick(0);
        // Contradicts a's change, and BlastNeedsPriority rejects a Bulk
        // service change outright: reject wins.
        let mut bulk = scale_by("b", 1, "web", 5);
        bulk.priority = Priority::Bulk;
        p.complete(&IntentKey::new("a", 1), Outcome::Succeeded, 1)
            .unwrap();
        p.submit(bulk, 1).unwrap();
        let report = p.tick(1);
        assert_eq!(verdicts(&report), ["reject"]);
        let labels: Vec<(&str, &str)> = report.decisions[0]
            .breakdown
            .iter()
            .map(|(n, v)| (n.as_str(), v.label()))
            .collect();
        assert_eq!(
            labels,
            [
                ("no-global-destroy", "admit"),
                ("blast-needs-priority", "reject"),
                ("resource-allowlist", "admit"),
                (CONFLICT_CHECK, "defer"),
            ]
        );
    }

    #[test]
    fn a_failed_change_still_holds_its_claim() {
        let mut p = plane();
        p.submit(scale_by("a", 1, "web", 3), 0).unwrap();
        p.tick(0);
        p.complete(
            &IntentKey::new("a", 1),
            Outcome::Failed("timeout".into()),
            1,
        )
        .unwrap();
        // It may have partly applied, so it still counts.
        p.submit(scale_by("b", 1, "web", 5), 1).unwrap();
        assert_eq!(verdicts(&p.tick(1)), ["defer"]);
    }

    #[test]
    fn destroy_conflicts_with_any_change_to_the_same_resource() {
        let mut p = plane().with_scheduler(SchedulerConfig::default().with_conflict_window(0));
        assert_eq!(p.scheduler_config().conflict_window(), 0);
        p.submit(
            Intent::new(
                1,
                AgentId::new("a"),
                Action::Destroy {
                    resource: "web".into(),
                },
                Priority::Normal,
                BlastRadius::Service,
            ),
            0,
        )
        .unwrap();
        p.tick(0);
        // With a zero window only the in-flight destroy counts; this one
        // waits for the lane, and by then the destroy has completed.
        p.submit(scale_by("b", 1, "web", 5), 0).unwrap();
        assert!(p.tick(0).decisions.is_empty());
        p.complete(&IntentKey::new("a", 1), Outcome::Succeeded, 1)
            .unwrap();
        assert_eq!(verdicts(&p.tick(1)), ["admit"]);
    }

    #[test]
    fn a_limit_above_one_still_catches_conflicts_within_one_pass() {
        let mut p = plane().with_scheduler(SchedulerConfig::default().with_limit("web", 3));
        p.submit(scale_by("a", 1, "web", 3), 0).unwrap();
        p.submit(scale_by("b", 1, "web", 9), 0).unwrap();
        p.submit(scale_by("c", 1, "web", 3), 0).unwrap();
        // All three fit under the limit. b contradicts a, which was
        // dispatched moments earlier in the same pass; c agrees with a.
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["admit", "defer", "admit"]);
        assert_eq!(p.in_flight().count(), 2);
    }

    /// "cache" is off the allowlist in `plane()`, so this is deferred.
    fn off_list(id: u64) -> Intent {
        scale(id, "cache")
    }

    #[test]
    fn a_deferred_intent_is_held_not_dropped() {
        let mut p = plane();
        let key = off_list(1).key();
        p.submit(off_list(1), 3).unwrap();
        assert_eq!(verdicts(&p.tick(3)), ["defer"]);
        let held: Vec<&Held> = p.held().collect();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].intent.key(), key);
        assert_eq!(held[0].since, 3);
        assert_eq!(held[0].reason, "resource 'cache' is not on the allowlist");
        assert!(p.is_held(&key));
        // Still live: the same key cannot be submitted again.
        assert_eq!(p.submit(off_list(1), 4), Err(Rejected::Duplicate));
        // Nothing else happens to it on its own.
        assert!(p.tick(100).decisions.is_empty());
        assert!(p.is_held(&key));
    }

    #[test]
    fn release_waives_deferrals_and_records_who_released() {
        let mut p = plane();
        let key = off_list(1).key();
        p.submit(off_list(1), 0).unwrap();
        p.tick(0);
        p.release(&key, "alice", 2).unwrap();
        assert!(!p.is_held(&key));
        assert_eq!(p.pending(), 1);
        let released = p.ledger().records().last().unwrap();
        assert_eq!(released.verdict, "released");
        assert_eq!(
            released.evidence.reason.as_deref(),
            Some("released by alice; held since tick 0 for: resource 'cache' is not on the allowlist")
        );

        let report = p.tick(2);
        let d = &report.decisions[0];
        assert_eq!(d.verdict, Verdict::Admit);
        assert_eq!(d.released_by.as_deref(), Some("alice"));
        // The breakdown still shows what was overridden.
        assert!(d
            .breakdown
            .iter()
            .any(|(name, v)| name == "resource-allowlist" && matches!(v, Verdict::Defer(_))));
        let record = p.ledger().records().last().unwrap();
        assert_eq!(record.verdict, "admit");
        assert_eq!(
            record.evidence.reason.as_deref(),
            Some("released by alice, overriding: resource 'cache' is not on the allowlist")
        );
        assert!(p.is_in_flight(&key));
        // The waiver is spent: the next intent is judged normally.
        p.complete(&key, Outcome::Succeeded, 3).unwrap();
        p.submit(off_list(2), 3).unwrap();
        assert_eq!(verdicts(&p.tick(3)), ["defer"]);
    }

    /// A policy whose answer changes while an intent is held.
    struct Ban(std::sync::Arc<std::sync::atomic::AtomicBool>);

    impl Policy for Ban {
        fn name(&self) -> &str {
            "ban"
        }
        fn evaluate(&self, _intent: &Intent) -> Verdict {
            if self.0.load(std::sync::atomic::Ordering::Relaxed) {
                Verdict::Reject("banned".into())
            } else {
                Verdict::Admit
            }
        }
    }

    #[test]
    fn release_does_not_override_a_reject() {
        let banned = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let gate = Gate::new()
            .with(ResourceAllowlist::new(["web"]))
            .with(Ban(banned.clone()));
        let mut p = Floodwall::new(Admission::new(8, RateLimit::new(8.0, 1.0)), gate);
        let key = off_list(1).key();
        p.submit(off_list(1), 0).unwrap();
        assert_eq!(verdicts(&p.tick(0)), ["defer"]);
        // While it waits on hold, the policy tightens.
        banned.store(true, std::sync::atomic::Ordering::Relaxed);
        p.release(&key, "alice", 1).unwrap();
        let report = p.tick(1);
        assert_eq!(verdicts(&report), ["reject"]);
        assert_eq!(report.decisions[0].released_by.as_deref(), Some("alice"));
        assert_eq!(
            p.ledger()
                .records()
                .last()
                .unwrap()
                .evidence
                .reason
                .as_deref(),
            Some("released by alice, but still rejected: banned")
        );
        // Rejected is final: the key is free again.
        assert!(!p.is_held(&key) && !p.is_in_flight(&key) && p.pending() == 0);
        assert_eq!(p.submit(off_list(1), 2), Ok(()));
    }

    #[test]
    fn a_released_change_waits_for_a_contradicting_change_still_in_flight() {
        let mut p = plane().with_scheduler(SchedulerConfig::default().with_limit("web", 2));
        p.submit(scale_by("a", 1, "web", 3), 0).unwrap();
        p.submit(scale_by("b", 1, "web", 8), 0).unwrap();
        assert_eq!(verdicts(&p.tick(0)), ["admit", "defer"]);
        // A human sides with b while a's change is still being applied.
        let b = IntentKey::new("b", 1);
        p.release(&b, "alice", 1).unwrap();
        // The limit would let b run now, but never alongside a.
        assert!(p.tick(1).decisions.is_empty());
        assert_eq!(p.pending(), 1);
        p.complete(&IntentKey::new("a", 1), Outcome::Succeeded, 2)
            .unwrap();
        // a is done; its conflict window is waived for b.
        let report = p.tick(2);
        assert_eq!(verdicts(&report), ["admit"]);
        assert_eq!(report.decisions[0].released_by.as_deref(), Some("alice"));
    }

    #[test]
    fn a_released_change_still_waits_for_its_lane() {
        let mut p = plane();
        p.submit(scale(1, "cache"), 0).unwrap();
        p.tick(0); // deferred
        let mut busy = scale(2, "cache");
        busy.agent = AgentId::new("other");
        // Put something in flight on cache without the allowlist: release
        // it too.
        p.submit(busy, 0).unwrap();
        p.tick(0); // deferred
        p.release(&IntentKey::new("other", 2), "alice", 1).unwrap();
        assert_eq!(verdicts(&p.tick(1)), ["admit"]);
        p.release(&IntentKey::new("bot", 1), "alice", 2).unwrap();
        // cache's lane is taken (limit 1), so the released change waits.
        assert!(p.tick(2).decisions.is_empty());
        p.complete(&IntentKey::new("other", 2), Outcome::Succeeded, 3)
            .unwrap();
        assert_eq!(verdicts(&p.tick(3)), ["admit"]);
    }

    #[test]
    fn release_and_expire_only_act_on_held_intents() {
        let mut p = plane();
        let queued = scale(1, "web").key();
        p.submit(scale(1, "web"), 0).unwrap();
        let missing = IntentKey::new("ghost", 1);
        for key in [&queued, &missing] {
            assert_eq!(
                p.release(key, "alice", 0),
                Err(HoldError::NotHeld(key.clone()))
            );
            assert_eq!(
                p.expire(key, "alice", 0),
                Err(HoldError::NotHeld(key.clone()))
            );
        }
        p.tick(0); // now in flight
        assert_eq!(
            p.release(&queued, "alice", 0),
            Err(HoldError::NotHeld(queued.clone()))
        );
        // Nothing was recorded for the failed attempts.
        assert_eq!(p.ledger().len(), 1);

        p.submit(off_list(2), 0).unwrap();
        p.tick(0);
        let held = off_list(2).key();
        p.release(&held, "alice", 1).unwrap();
        // Already released: a second release finds nothing.
        assert_eq!(
            p.release(&held, "bob", 1),
            Err(HoldError::NotHeld(held.clone()))
        );
    }

    #[test]
    fn release_into_a_full_queue_leaves_the_intent_held() {
        let mut p = Floodwall::new(
            Admission::new(1, RateLimit::new(8.0, 1.0)),
            Gate::new().with(ResourceAllowlist::new(["web"])),
        );
        p.submit(off_list(1), 0).unwrap();
        p.tick(0);
        let key = off_list(1).key();
        p.submit(scale(2, "web"), 0).unwrap(); // fills the queue (capacity 1)
        let records = p.ledger().len();
        assert_eq!(
            p.release(&key, "alice", 1),
            Err(HoldError::Backpressure(key.clone()))
        );
        assert!(p.is_held(&key));
        assert_eq!(p.ledger().len(), records);
        p.tick(1); // drains the queue
        assert_eq!(p.release(&key, "alice", 2), Ok(()));
    }

    #[test]
    fn a_human_can_expire_a_held_intent() {
        let mut p = plane();
        let key = off_list(1).key();
        p.submit(off_list(1), 0).unwrap();
        p.tick(0);
        let held = p.expire(&key, "bob", 4).unwrap();
        assert_eq!(held.intent.key(), key);
        assert_eq!(held.reason, "resource 'cache' is not on the allowlist");
        assert!(!p.is_held(&key));
        let record = p.ledger().records().last().unwrap();
        assert_eq!(record.verdict, "expired");
        assert_eq!(record.evidence.reason.as_deref(), Some("expired by bob"));
        // The key is free again.
        assert_eq!(p.submit(off_list(1), 5), Ok(()));
    }

    #[test]
    fn held_intents_expire_after_their_ttl() {
        let mut p = plane().with_hold(HoldConfig::default().with_ttl(Some(5)));
        assert_eq!(p.hold_config().ttl(), Some(5));
        p.submit(off_list(1), 0).unwrap();
        p.tick(0);
        p.submit(off_list(2), 3).unwrap();
        p.tick(3);
        assert!(p.tick(4).expired.is_empty());
        let report = p.tick(5);
        assert_eq!(report.expired.len(), 1);
        assert_eq!(report.expired[0].intent.id, 1);
        let record = p.ledger().records().last().unwrap();
        assert_eq!(record.verdict, "expired");
        assert_eq!(
            record.evidence.reason.as_deref(),
            Some("held since tick 0 for 5 ticks, reaching the hold TTL of 5")
        );
        assert_eq!(p.submit(off_list(1), 5), Ok(()), "the key is free");
        assert_eq!(p.tick(8).expired[0].intent.id, 2);
    }

    #[test]
    fn a_full_hold_evicts_its_oldest_intent() {
        let mut p = plane().with_hold(HoldConfig::default().with_capacity(1));
        p.submit(off_list(1), 0).unwrap();
        p.submit(off_list(2), 0).unwrap();
        // cache's lane is free for both (each is deferred, never dispatched).
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["defer", "defer"]);
        assert_eq!(report.expired.len(), 1);
        assert_eq!(report.expired[0].intent.id, 1);
        let labels: Vec<&str> = p
            .ledger()
            .records()
            .iter()
            .map(|r| r.verdict.as_str())
            .collect();
        assert_eq!(labels, ["defer", "defer", "expired"]);
        assert_eq!(
            p.ledger().records()[2].evidence.reason.as_deref(),
            Some("evicted: the hold queue is full (capacity 1)")
        );
        assert_eq!(p.held().map(|h| h.intent.id).collect::<Vec<_>>(), [2]);
    }

    #[test]
    fn a_zero_capacity_hold_expires_deferrals_at_once() {
        let mut p = plane().with_hold(HoldConfig::default().with_capacity(0));
        p.submit(off_list(1), 0).unwrap();
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["defer"]);
        assert_eq!(report.expired.len(), 1);
        assert_eq!(p.held().count(), 0);
        assert_eq!(p.submit(off_list(1), 1), Ok(()));
    }

    #[test]
    fn shrinking_the_hold_evicts_at_the_next_tick() {
        let mut p = plane();
        for id in 1..=3 {
            p.submit(off_list(id), 0).unwrap();
        }
        p.tick(0);
        assert_eq!(p.held().count(), 3);
        let mut p = p.with_hold(HoldConfig::default().with_capacity(1));
        let report = p.tick(1);
        assert_eq!(
            report
                .expired
                .iter()
                .map(|h| h.intent.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(p.held().map(|h| h.intent.id).collect::<Vec<_>>(), [3]);
    }

    #[test]
    fn time_never_moves_backwards() {
        let mut p = plane();
        p.submit(scale(1, "web"), 10).unwrap();
        assert_eq!(p.clock(), 10);
        p.tick(4);
        assert_eq!(p.clock(), 10);
        // Dispatched at the clock, not the stale tick.
        assert_eq!(p.in_flight().next().unwrap().since, 10);
    }

    // A plane can be built around an Admission that already holds queued
    // intents. Review repro on PR #11: those intents were not live, so a
    // resubmitted key was accepted, both copies were dispatched, and the
    // resource bookkeeping was corrupted; the plane's clock also restarted
    // at 0.

    fn populated(at: u64, intents: Vec<Intent>) -> Admission {
        let mut admission = Admission::new(16, RateLimit::new(8.0, 1.0));
        for intent in intents {
            admission.submit(intent, at).unwrap();
        }
        admission
    }

    #[test]
    fn a_populated_admission_s_queued_intents_are_live() {
        let mut p = Floodwall::new(populated(100, vec![scale(1, "web")]), Gate::new());
        assert_eq!(p.pending(), 1);
        // The review repro: the same key aimed at another resource.
        assert_eq!(p.submit(scale(1, "api"), 0), Err(Rejected::Duplicate));
        // Only the queued copy is dispatched, and its lane is tracked.
        assert_eq!(verdicts(&p.tick(0)), ["admit"]);
        assert_eq!(p.in_flight().count(), 1);
        p.submit(scale(2, "web"), 100).unwrap();
        assert!(p.tick(100).decisions.is_empty(), "web's lane is taken");
        p.complete(&IntentKey::new("bot", 1), Outcome::Succeeded, 101)
            .unwrap();
        // Completing it frees web for the next change.
        assert_eq!(verdicts(&p.tick(101)), ["admit"]);
        // And the adopted key is reusable once it is done.
        assert_eq!(p.submit(scale(1, "api"), 101), Ok(()));
    }

    #[test]
    fn a_populated_admission_s_clock_carries_over() {
        let p = Floodwall::new(populated(100, vec![scale(1, "web")]), Gate::new());
        assert_eq!(p.clock(), 100);
        let mut p = p;
        // A stale tick is treated as the adopted clock.
        p.tick(0);
        assert_eq!(p.clock(), 100);
        assert_eq!(p.in_flight().next().unwrap().since, 100);
        // An empty Admission that has seen time carries it over too.
        let mut idle = Admission::new(4, RateLimit::new(8.0, 1.0));
        idle.prune_idle(42);
        assert_eq!(Floodwall::new(idle, Gate::new()).clock(), 42);
    }

    #[test]
    fn an_admission_queueing_one_key_twice_is_refused() {
        // Admission does not track identity, so it can hold two intents
        // with one key; the plane refuses to adopt it.
        let twice = || populated(5, vec![scale(1, "web"), scale(1, "api"), scale(2, "db")]);
        assert_eq!(
            Floodwall::try_new(twice(), Gate::new()).err(),
            Some(DuplicateQueued(IntentKey::new("bot", 1)))
        );
        assert_eq!(
            DuplicateQueued(IntentKey::new("bot", 1)).to_string(),
            "intent bot#1 is queued more than once in the admission controller"
        );
        let unique = populated(5, vec![scale(1, "web"), scale(2, "api")]);
        let p = Floodwall::try_new(unique, Gate::new()).expect("unique keys");
        assert_eq!((p.pending(), p.clock()), (2, 5));
    }

    #[test]
    #[should_panic(expected = "intent bot#1 is queued more than once")]
    fn new_panics_on_an_admission_queueing_one_key_twice() {
        let _ = Floodwall::new(
            populated(0, vec![scale(1, "web"), scale(1, "web")]),
            Gate::new(),
        );
    }

    // Signed intents (FW-302).

    fn bot_key() -> SigningKey {
        SigningKey::from_seed(&[1; 32])
    }

    fn other_key() -> SigningKey {
        SigningKey::from_seed(&[2; 32])
    }

    fn keyring() -> Keyring {
        Keyring::new()
            .with("bot", bot_key().verifying_key())
            .with("other", other_key().verifying_key())
    }

    fn signed_plane() -> Floodwall {
        plane().with_keyring(keyring())
    }

    #[test]
    fn a_keyring_admits_signed_intents_and_the_ledger_proves_who_sent_them() {
        let mut p = signed_plane();
        assert!(p.keyring().is_some());
        let intent = scale(1, "web").signed(&bot_key());
        let digest = intent.digest();
        p.submit(intent, 0).unwrap();
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["admit"]);
        // The signature check shows in the breakdown, before the conflict
        // check.
        let names: Vec<&str> = report.decisions[0]
            .breakdown
            .iter()
            .map(|(n, _)| n.as_str())
            .collect();
        assert_eq!(names[names.len() - 2..], [SIGNATURE_CHECK, CONFLICT_CHECK]);
        p.complete(&IntentKey::new("bot", 1), Outcome::Succeeded, 1)
            .unwrap();
        // Both records carry the intent's digest and signature.
        for r in p.ledger().records() {
            assert_eq!(r.intent_digest(), Some(digest));
            assert!(r.signature().is_some());
        }
        assert_eq!(p.ledger().verify_signatures(&keyring()), Ok(2));
    }

    #[test]
    fn a_keyring_refuses_unsigned_unknown_and_forged_intents() {
        let mut p = signed_plane();
        assert_eq!(p.submit(scale(1, "web"), 0), Err(Rejected::Unsigned));
        let mut stranger = scale(2, "web");
        stranger.agent = AgentId::new("stranger");
        assert_eq!(
            p.submit(stranger.signed(&bot_key()), 0),
            Err(Rejected::UnknownAgent)
        );
        // Another agent signing in bot's name.
        assert_eq!(
            p.submit(scale(3, "web").signed(&other_key()), 0),
            Err(Rejected::BadSignature)
        );
        // Changed after signing.
        let mut tampered = scale(4, "web").signed(&bot_key());
        tampered.priority = Priority::Pager;
        assert_eq!(p.submit(tampered, 0), Err(Rejected::BadSignature));
        // Nothing reached the queue or the ledger.
        assert_eq!(p.pending(), 0);
        assert!(p.ledger().is_empty());
    }

    #[test]
    fn forgeries_are_refused_before_duplicates_and_rate_limits() {
        let admission = Admission::new(16, RateLimit::new(1.0, 0.0));
        let mut p = Floodwall::new(admission, Gate::new()).with_keyring(keyring());
        p.submit(scale(1, "web").signed(&bot_key()), 0).unwrap();
        // A forgery reusing a live key is refused as a forgery: it learns
        // nothing about what is queued.
        assert_eq!(
            p.submit(scale(1, "web").signed(&other_key()), 0),
            Err(Rejected::BadSignature)
        );
        // Forgeries in other's name do not spend other's only token.
        let mut forged = scale(1, "web");
        forged.agent = AgentId::new("other");
        for _ in 0..3 {
            assert_eq!(
                p.submit(forged.clone().signed(&bot_key()), 0),
                Err(Rejected::BadSignature)
            );
        }
        assert_eq!(p.submit(forged.signed(&other_key()), 0), Ok(()));
    }

    #[test]
    fn an_adopted_unsigned_intent_is_rejected_when_ruled_on() {
        // Intents queued in Admission directly never went through submit.
        let admission = populated(0, vec![scale(1, "web"), scale(2, "api").signed(&bot_key())]);
        let mut p = Floodwall::new(admission, Gate::new()).with_keyring(keyring());
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["reject", "admit"]);
        let rejected = &report.decisions[0];
        assert_eq!(rejected.verdict.reason(), Some("the intent is not signed"));
        assert!(rejected
            .breakdown
            .iter()
            .any(|(n, v)| n == SIGNATURE_CHECK && matches!(v, Verdict::Reject(_))));
        // The rejection is recorded, unsigned; the admitted one is signed.
        let records = p.ledger().records();
        assert_eq!(records[0].verdict, "reject");
        assert_eq!(records[0].signature(), None);
        assert!(records[1].signature().is_some());
        // An auditor sees exactly which record has no proof of authorship.
        assert_eq!(
            p.ledger().verify_signatures(&keyring()).map_err(|e| e.seq),
            Err(0)
        );
    }

    #[test]
    fn a_new_keyring_rechecks_what_is_already_queued() {
        let mut p = signed_plane();
        p.submit(scale(1, "web").signed(&bot_key()), 0).unwrap();
        // Bot's key is rotated before the intent is ruled on.
        let rotated = Keyring::new().with("bot", other_key().verifying_key());
        let mut p = p.with_keyring(rotated);
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["reject"]);
        assert_eq!(
            report.decisions[0].verdict.reason(),
            Some("the signature is not the agent's signature of this intent")
        );
    }

    #[test]
    fn signed_intents_keep_their_proof_through_hold_and_release() {
        let mut p = signed_plane();
        let key = off_list(1).key();
        p.submit(off_list(1).signed(&bot_key()), 0).unwrap();
        assert_eq!(verdicts(&p.tick(0)), ["defer"]);
        p.release(&key, "alice", 1).unwrap();
        assert_eq!(verdicts(&p.tick(1)), ["admit"]);
        p.complete(&key, Outcome::Succeeded, 2).unwrap();
        p.submit(off_list(2).signed(&bot_key()), 3).unwrap();
        p.tick(3);
        p.expire(&off_list(2).key(), "alice", 4).unwrap();
        let labels: Vec<&str> = p
            .ledger()
            .records()
            .iter()
            .map(|r| r.verdict.as_str())
            .collect();
        assert_eq!(
            labels,
            [
                "defer",
                "released",
                "admit",
                "succeeded",
                "defer",
                "expired"
            ]
        );
        assert_eq!(p.ledger().verify_signatures(&keyring()), Ok(6));
        assert!(p.ledger().verify());
    }

    #[test]
    fn without_a_keyring_signatures_are_optional_and_unchecked() {
        let mut p = plane();
        assert!(p.keyring().is_none());
        p.submit(scale(1, "web"), 0).unwrap();
        // Even a signature from an unknown key is just carried along.
        p.submit(scale(2, "api").signed(&other_key()), 0).unwrap();
        let report = p.tick(0);
        assert_eq!(verdicts(&report), ["admit", "admit"]);
        assert!(report.decisions[0]
            .breakdown
            .iter()
            .all(|(n, _)| n != SIGNATURE_CHECK));
        assert!(p.ledger().records()[1].signature().is_some());
    }

    // Checkpoints (FW-303).

    #[test]
    fn a_plane_checkpoints_its_ledger_for_suffix_audits() {
        let plane_key = SigningKey::from_seed(&[50; 32]);
        let ledger = Ledger::new()
            .with_checkpoints(3)
            .with_signer(plane_key.clone());
        let mut p = plane().with_ledger(ledger);
        for id in 1..=4 {
            p.submit(scale(id, ["web", "api", "db", "queue"][id as usize - 1]), 0)
                .unwrap();
        }
        p.tick(0); // web, api admitted; db, queue deferred (off the allowlist)
        for id in 1..=2 {
            p.complete(&IntentKey::new("bot", id), Outcome::Succeeded, 1)
                .unwrap();
        }
        let latest = p.checkpoint(); // 6 records
        let cps = p.ledger().checkpoints();
        assert_eq!(cps.iter().map(|c| c.size).collect::<Vec<_>>(), [3, 6]);
        assert_eq!(latest, cps[1]);
        // An auditor holding only the first checkpoint and the plane's key
        // checks everything after it.
        let first = cps[0].clone();
        let suffix = p.ledger().records_after(&first).unwrap();
        assert_eq!(
            audit_suffix(&first, &latest, suffix, Some(&plane_key.verifying_key())),
            Ok(())
        );
        assert!(p.ledger().verify());
    }

    #[test]
    #[should_panic(expected = "with_ledger needs an empty ledger")]
    fn with_ledger_refuses_a_ledger_with_history() {
        let mut ledger = Ledger::new();
        ledger.append(1, "bot", "admit");
        let _ = plane().with_ledger(ledger);
    }

    #[test]
    #[should_panic(expected = "with_ledger needs an empty ledger")]
    fn with_ledger_refuses_a_plane_with_history() {
        let mut p = plane();
        p.submit(scale(1, "web"), 0).unwrap();
        p.tick(0);
        let _ = p.with_ledger(Ledger::new());
    }
}
