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
pub mod gate;
pub mod intent;
pub mod ledger;
pub mod policy;
pub mod scheduler;

use std::collections::HashSet;
use std::fmt;

pub use admission::{Admission, InvalidRateLimit, RateLimit, Rejected};
pub use gate::{Gate, GateDecision};
pub use intent::{Intent, IntentKey};
pub use ledger::{Evidence, Ledger, Record};
pub use policy::{Policy, Verdict};
pub use scheduler::InFlight;

use scheduler::{Readiness, Scheduler};

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
}

/// Everything one [`Floodwall::tick`] did.
#[derive(Debug, Default)]
pub struct TickReport {
    /// Every intent ruled on in this tick, in the order they were ruled on.
    pub decisions: Vec<Decision>,
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
    /// Every intent that is queued or in flight. An intent key can only be
    /// live once, so a resubmitted duplicate is refused.
    live: HashSet<IntentKey>,
    clock: u64,
}

impl Floodwall {
    /// Assemble a control plane from an admission controller and a gate.
    pub fn new(admission: Admission, gate: Gate) -> Self {
        Self {
            admission,
            scheduler: Scheduler::new(),
            gate,
            ledger: Ledger::new(),
            live: HashSet::new(),
            clock: 0,
        }
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
    /// Refused with [`Rejected::Duplicate`] if an intent with the same
    /// [`IntentKey`] is already queued or in flight, and otherwise with
    /// [`Rejected::Backpressure`] or [`Rejected::RateLimited`] by admission.
    /// A duplicate is caught first, so it does not use the agent's rate
    /// allowance.
    pub fn submit(&mut self, intent: Intent, now: u64) -> Result<(), Rejected> {
        let now = self.advance(now);
        let key = intent.key();
        if self.live.contains(&key) {
            return Err(Rejected::Duplicate);
        }
        self.admission.submit(intent, now)?;
        self.live.insert(key);
        Ok(())
    }

    /// One scheduling pass at logical time `now`: walk the queue in
    /// priority order, and rule on every intent that may start now. Each
    /// decision is recorded in the ledger. Admitted intents are dispatched:
    /// apply them, then call [`Floodwall::complete`].
    pub fn tick(&mut self, now: u64) -> TickReport {
        let now = self.advance(now);
        let mut report = TickReport::default();
        let mut pass = self.scheduler.begin();
        for position in self.admission.queued_keys() {
            if pass.is_closed() {
                break;
            }
            let intent = self
                .admission
                .get(&position)
                .expect("positions in the snapshot are only taken below");
            match self.scheduler.readiness(intent, &pass) {
                Readiness::Blocked => self.scheduler.wait(intent, &mut pass),
                Readiness::Ready => {
                    let intent = self
                        .admission
                        .take(&position)
                        .expect("the position was just read");
                    report.decisions.push(self.decide(intent, now));
                }
            }
        }
        report
    }

    /// Rule on an intent that may start now, record the decision, and
    /// dispatch it if admitted.
    fn decide(&mut self, intent: Intent, now: u64) -> Decision {
        let decision = self.gate.evaluate(&intent);
        let policies = decision
            .breakdown
            .iter()
            .map(|(name, verdict)| (name.clone(), verdict.label().to_string()))
            .collect();
        self.record(
            &intent,
            decision.verdict.label(),
            decision.verdict.reason().map(str::to_string),
            policies,
        );
        if decision.verdict.is_admit() {
            self.scheduler.start(intent.clone(), now);
        } else {
            self.live.remove(&intent.key());
        }
        Decision {
            intent,
            verdict: decision.verdict,
            breakdown: decision.breakdown,
        }
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
        self.live.remove(key);
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
        let evidence = Evidence {
            action: intent.action.to_string(),
            reason,
            policies,
        };
        self.ledger
            .append_with(intent.id, intent.agent.as_str(), label, evidence);
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

    /// Whether the intent `key` is in flight.
    pub fn is_in_flight(&self, key: &IntentKey) -> bool {
        self.scheduler.is_in_flight(key)
    }

    /// The decision ledger.
    pub fn ledger(&self) -> &Ledger {
        &self.ledger
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
}
