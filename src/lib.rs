//! # floodwall
//!
//! A control plane for high-volume, agent-driven DevOps.
//!
//! When a fleet of agents floods your infrastructure with changes, the
//! bottleneck stops being *authoring* changes and becomes *governing* them.
//! `floodwall` is the barrier in front of production: agents press
//! their [`Intent`]s against the wall, a throughput governor ([`Admission`])
//! decides how fast and in what order they reach the gate, a policy [`Gate`]
//! rules on each one, and every decision is written to a tamper-evident
//! [`Ledger`].
//!
//! The four pieces compose into one [`Floodwall`]:
//!
//! ```text
//!   flood of intents
//!        |
//!   [ Admission ]   per-agent rate limit + bounded priority queue (backpressure)
//!        |
//!   [   Gate    ]   deny-overrides stack of policies
//!        |
//!   [  Ledger   ]   hash-chained record of every verdict
//!        |
//!   dry ground (production)
//! ```
//!
//! ```
//! use floodwall::{Admission, Floodwall, Gate, RateLimit, Verdict};
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
//! plane.submit(intent, 0).unwrap();
//!
//! let decision = plane.tick().unwrap();
//! assert_eq!(decision.verdict, Verdict::Admit);
//! assert!(plane.ledger().verify());
//! ```

pub mod admission;
pub mod gate;
pub mod intent;
pub mod ledger;
pub mod policy;

pub use admission::{Admission, InvalidRateLimit, RateLimit, Rejected};
pub use gate::{Gate, GateDecision};
pub use intent::Intent;
pub use ledger::{Evidence, Ledger, Record};
pub use policy::{Policy, Verdict};

/// The outcome of processing one intent: the intent itself, the gate's combined
/// verdict, and the per-policy breakdown that produced it.
#[derive(Debug)]
pub struct Decision {
    /// The intent that was processed.
    pub intent: Intent,
    /// The combined verdict.
    pub verdict: Verdict,
    /// Each policy's name and its individual verdict.
    pub breakdown: Vec<(String, Verdict)>,
}

/// The control plane: admission control in front of a policy gate, with every
/// decision recorded in a tamper-evident ledger.
pub struct Floodwall {
    admission: Admission,
    gate: Gate,
    ledger: Ledger,
}

impl Floodwall {
    /// Assemble a control plane from an admission controller and a gate.
    pub fn new(admission: Admission, gate: Gate) -> Self {
        Self {
            admission,
            gate,
            ledger: Ledger::new(),
        }
    }

    /// Offer an intent to the wall at logical time `now`. Returns
    /// [`Rejected`] if it is rate-limited or the queue is full.
    pub fn submit(&mut self, intent: Intent, now: u64) -> Result<(), Rejected> {
        self.admission.submit(intent, now)
    }

    /// Process the next waiting intent: pull the highest-priority one, rule on
    /// it at the gate, and record the decision in the ledger. Returns `None`
    /// when nothing is waiting.
    pub fn tick(&mut self) -> Option<Decision> {
        let intent = self.admission.dequeue()?;
        let decision = self.gate.evaluate(&intent);
        let evidence = Evidence {
            action: intent.action.to_string(),
            reason: decision.verdict.reason().map(str::to_string),
            policies: decision
                .breakdown
                .iter()
                .map(|(name, verdict)| (name.clone(), verdict.label().to_string()))
                .collect(),
        };
        self.ledger.append_with(
            intent.id,
            intent.agent.as_str(),
            decision.verdict.label(),
            evidence,
        );
        Some(Decision {
            intent,
            verdict: decision.verdict,
            breakdown: decision.breakdown,
        })
    }

    /// How many intents are waiting at the wall.
    pub fn pending(&self) -> usize {
        self.admission.len()
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

    #[test]
    fn admitted_change_flows_through_and_is_recorded() {
        let mut p = plane();
        p.submit(
            intent(
                1,
                Action::Scale {
                    resource: "web".into(),
                    replicas: 3,
                },
                Priority::Normal,
                BlastRadius::Service,
            ),
            0,
        )
        .unwrap();
        assert_eq!(p.pending(), 1);
        let d = p.tick().unwrap();
        assert_eq!(d.verdict, Verdict::Admit);
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
        let d = p.tick().unwrap();
        assert!(matches!(d.verdict, Verdict::Reject(_)));
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
        assert!(p.ledger().verify());
    }

    #[test]
    fn tick_on_empty_plane_is_none() {
        let mut p = plane();
        assert!(p.tick().is_none());
    }
}
