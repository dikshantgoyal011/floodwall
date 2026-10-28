//! The gate in the floodwall.
//!
//! Every intent that reaches the gate is ruled on by the full policy stack. The
//! gate combines those rulings with *deny-overrides*: the harshest verdict
//! wins, so a single `Reject` blocks the change no matter how many policies
//! admit it.

use crate::intent::Intent;
use crate::policy::{Policy, Verdict};
use crate::rules::BundleId;

/// The combined ruling plus the per-policy breakdown that produced it.
#[derive(Debug)]
pub struct GateDecision {
    /// The deny-overrides combination of every policy's verdict.
    pub verdict: Verdict,
    /// Each policy's name and its individual verdict, in evaluation order.
    pub breakdown: Vec<(String, Verdict)>,
}

/// A deny-overrides stack of policies.
#[derive(Default)]
pub struct Gate {
    policies: Vec<Box<dyn Policy>>,
    /// The bundles of the rules files loaded into the stack, in order.
    pub(crate) bundles: Vec<BundleId>,
}

impl Gate {
    /// An empty gate. With no policies it admits everything.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a policy to the stack. Builder style.
    pub fn with(mut self, policy: impl Policy + 'static) -> Self {
        self.policies.push(Box::new(policy));
        self
    }

    /// Number of policies in the stack.
    pub fn len(&self) -> usize {
        self.policies.len()
    }

    /// Whether the stack is empty.
    pub fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }

    /// The policy bundles the stack's rules came from, in the order they
    /// were loaded ([`Gate::with_rules`]; see
    /// [Bundles](crate::rules#bundles)). Every decision records them.
    pub fn bundles(&self) -> &[BundleId] {
        &self.bundles
    }

    /// Rule on one intent, returning the combined verdict and the full
    /// breakdown. The breakdown always records every policy, even once the
    /// combined verdict is already a `Reject`, so the audit trail is complete.
    pub fn evaluate(&self, intent: &Intent) -> GateDecision {
        let mut combined = Verdict::Admit;
        let mut breakdown = Vec::with_capacity(self.policies.len());
        for policy in &self.policies {
            let verdict = policy.evaluate(intent);
            if verdict.rank() > combined.rank() {
                combined = verdict.clone();
            }
            breakdown.push((policy.name().to_string(), verdict));
        }
        GateDecision {
            verdict: combined,
            breakdown,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, AgentId, BlastRadius, Intent, Priority};
    use crate::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};

    fn intent(priority: Priority, blast: BlastRadius, resource: &str) -> Intent {
        Intent::new(
            0,
            AgentId::new("a"),
            Action::Apply {
                resource: resource.into(),
                manifest: String::new(),
            },
            priority,
            blast,
        )
    }

    #[test]
    fn empty_gate_admits() {
        let gate = Gate::new();
        assert!(gate.is_empty());
        let d = gate.evaluate(&intent(Priority::Bulk, BlastRadius::Global, "x"));
        assert_eq!(d.verdict, Verdict::Admit);
        assert!(d.breakdown.is_empty());
    }

    #[test]
    fn deny_overrides_picks_the_harshest_verdict() {
        // allowlist would Defer "x", blast-needs-priority would Reject a Bulk
        // global. Reject must win over Defer.
        let gate = Gate::new()
            .with(ResourceAllowlist::new(["web"]))
            .with(BlastNeedsPriority);
        let d = gate.evaluate(&intent(Priority::Bulk, BlastRadius::Global, "x"));
        assert!(matches!(d.verdict, Verdict::Reject(_)));
        assert_eq!(d.breakdown.len(), 2);
    }

    #[test]
    fn defer_beats_admit_when_nothing_rejects() {
        let gate = Gate::new()
            .with(NoGlobalDestroy)
            .with(ResourceAllowlist::new(["web"]));
        // "x" is off the allowlist -> Defer; nothing rejects -> combined Defer.
        let d = gate.evaluate(&intent(Priority::Normal, BlastRadius::Cell, "x"));
        assert!(matches!(d.verdict, Verdict::Defer(_)));
    }

    #[test]
    fn all_admit_is_admit() {
        let gate = Gate::new()
            .with(NoGlobalDestroy)
            .with(BlastNeedsPriority)
            .with(ResourceAllowlist::new(["web"]));
        let d = gate.evaluate(&intent(Priority::Normal, BlastRadius::Cell, "web"));
        assert_eq!(d.verdict, Verdict::Admit);
        assert_eq!(d.breakdown.len(), 3);
    }
}
