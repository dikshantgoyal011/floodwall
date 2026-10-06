//! The verification gate's rules.
//!
//! Each [`Policy`] is a pure function from an [`Intent`] to a [`Verdict`]. The
//! [`Gate`](crate::gate::Gate) composes a stack of them with deny-overrides: a
//! change passes only if every policy admits it.

use crate::intent::{BlastRadius, Intent, Priority};

/// A policy's ruling on a single intent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Let it through.
    Admit,
    /// Block it outright. Carries a human-readable reason.
    Reject(String),
    /// Hold it for now (a freeze window, a missing allowlist entry). Carries a
    /// reason. A deferred change is not wrong, just not yet.
    Defer(String),
}

impl Verdict {
    /// Whether this verdict admits the change.
    pub fn is_admit(&self) -> bool {
        matches!(self, Verdict::Admit)
    }

    /// Severity rank for deny-overrides composition: `Reject > Defer > Admit`.
    pub(crate) fn rank(&self) -> u8 {
        match self {
            Verdict::Admit => 0,
            Verdict::Defer(_) => 1,
            Verdict::Reject(_) => 2,
        }
    }

    /// The human-readable reason, for a `Reject` or `Defer`.
    pub fn reason(&self) -> Option<&str> {
        match self {
            Verdict::Admit => None,
            Verdict::Reject(reason) | Verdict::Defer(reason) => Some(reason),
        }
    }

    /// A short, stable label for the ledger.
    pub fn label(&self) -> &'static str {
        match self {
            Verdict::Admit => "admit",
            Verdict::Defer(_) => "defer",
            Verdict::Reject(_) => "reject",
        }
    }
}

/// A rule applied at the gate.
pub trait Policy: Send + Sync {
    /// Stable name, recorded in the decision breakdown.
    fn name(&self) -> &str;
    /// Rule on the intent.
    fn evaluate(&self, intent: &Intent) -> Verdict;
}

/// Never let an agent destroy something global without a human. A runaway loop
/// emitting `Destroy { Global }` is the nightmare case; this is the backstop
/// that no other policy can override.
pub struct NoGlobalDestroy;

impl Policy for NoGlobalDestroy {
    fn name(&self) -> &str {
        "no-global-destroy"
    }

    fn evaluate(&self, intent: &Intent) -> Verdict {
        if intent.blast_radius == BlastRadius::Global && intent.action.is_destructive() {
            Verdict::Reject("destructive global change requires human sign-off".into())
        } else {
            Verdict::Admit
        }
    }
}

/// Wide-blast changes must carry real urgency. A `Bulk`-priority global rollout
/// is almost always a mistake or a runaway agent, not an intention, so the gate
/// rejects it.
pub struct BlastNeedsPriority;

impl Policy for BlastNeedsPriority {
    fn name(&self) -> &str {
        "blast-needs-priority"
    }

    fn evaluate(&self, intent: &Intent) -> Verdict {
        let needed = match intent.blast_radius {
            BlastRadius::Global | BlastRadius::Region => Priority::Urgent,
            BlastRadius::Service => Priority::Normal,
            BlastRadius::Cell => Priority::Bulk,
        };
        if intent.priority >= needed {
            Verdict::Admit
        } else {
            Verdict::Reject(format!(
                "{:?} blast radius needs priority >= {:?}, got {:?}",
                intent.blast_radius, needed, intent.priority
            ))
        }
    }
}

/// Only let the fleet touch resources on an allowlist. Anything off-list is
/// *deferred*, not rejected, so a human can extend the list and let it through.
pub struct ResourceAllowlist {
    allowed: Vec<String>,
}

impl ResourceAllowlist {
    /// Build an allowlist from any iterator of string-like names.
    pub fn new(allowed: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            allowed: allowed.into_iter().map(Into::into).collect(),
        }
    }
}

impl Policy for ResourceAllowlist {
    fn name(&self) -> &str {
        "resource-allowlist"
    }

    fn evaluate(&self, intent: &Intent) -> Verdict {
        let resource = intent.action.resource();
        if self.allowed.iter().any(|a| a == resource) {
            Verdict::Admit
        } else {
            Verdict::Defer(format!("resource '{resource}' is not on the allowlist"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, AgentId, Intent};

    fn intent(action: Action, priority: Priority, blast: BlastRadius) -> Intent {
        Intent::new(0, AgentId::new("a"), action, priority, blast)
    }

    #[test]
    fn no_global_destroy_blocks_only_destructive_global() {
        let p = NoGlobalDestroy;
        let destroy = Action::Destroy {
            resource: "x".into(),
        };
        assert!(!p
            .evaluate(&intent(
                destroy.clone(),
                Priority::Pager,
                BlastRadius::Global
            ))
            .is_admit());
        // Destructive, but not global - fine here.
        assert!(p
            .evaluate(&intent(destroy, Priority::Pager, BlastRadius::Cell))
            .is_admit());
        // Global, but not destructive - fine here.
        let apply = Action::Apply {
            resource: "x".into(),
            manifest: String::new(),
        };
        assert!(p
            .evaluate(&intent(apply, Priority::Pager, BlastRadius::Global))
            .is_admit());
    }

    #[test]
    fn blast_needs_priority_scales_the_bar_with_the_radius() {
        let p = BlastNeedsPriority;
        let apply = || Action::Apply {
            resource: "x".into(),
            manifest: String::new(),
        };
        // Global at Bulk: rejected.
        assert!(!p
            .evaluate(&intent(apply(), Priority::Bulk, BlastRadius::Global))
            .is_admit());
        // Global at Urgent: admitted.
        assert!(p
            .evaluate(&intent(apply(), Priority::Urgent, BlastRadius::Global))
            .is_admit());
        // Cell at Bulk: admitted - narrow changes need no urgency.
        assert!(p
            .evaluate(&intent(apply(), Priority::Bulk, BlastRadius::Cell))
            .is_admit());
        // Service at Bulk: rejected (needs Normal).
        assert!(!p
            .evaluate(&intent(apply(), Priority::Bulk, BlastRadius::Service))
            .is_admit());
    }

    #[test]
    fn allowlist_defers_unknown_resources() {
        let p = ResourceAllowlist::new(["web", "api"]);
        let on = Action::Apply {
            resource: "web".into(),
            manifest: String::new(),
        };
        let off = Action::Apply {
            resource: "secret-store".into(),
            manifest: String::new(),
        };
        assert_eq!(
            p.evaluate(&intent(on, Priority::Normal, BlastRadius::Cell)),
            Verdict::Admit
        );
        assert!(matches!(
            p.evaluate(&intent(off, Priority::Normal, BlastRadius::Cell)),
            Verdict::Defer(_)
        ));
    }
}
