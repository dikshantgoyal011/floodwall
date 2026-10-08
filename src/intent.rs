//! The unit of work.
//!
//! An [`Intent`] is a change an agent wants to make to live infrastructure. In
//! the floodwall model agents never touch production directly - they press
//! their Intents against the wall, and the control plane decides what passes
//! through the gate.

use std::fmt;

/// Stable identifier for an agent in the fleet.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AgentId(pub String);

impl AgentId {
    /// Construct an id from anything string-like.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Borrow the underlying string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AgentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a change does. Deliberately coarse for v0.1 - floodwall governs change,
/// it is not a Terraform clone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Create or update a resource from a manifest.
    Apply { resource: String, manifest: String },
    /// Change the replica count of a resource.
    Scale { resource: String, replicas: u32 },
    /// Tear a resource down.
    Destroy { resource: String },
}

impl Action {
    /// The resource this action targets.
    pub fn resource(&self) -> &str {
        match self {
            Action::Apply { resource, .. }
            | Action::Scale { resource, .. }
            | Action::Destroy { resource } => resource,
        }
    }

    /// Whether the action removes capacity or state: a teardown, or a scale to
    /// zero. These are the changes most worth gating.
    pub fn is_destructive(&self) -> bool {
        matches!(
            self,
            Action::Destroy { .. } | Action::Scale { replicas: 0, .. }
        )
    }

    /// Whether applying both actions would fight over the same resource:
    /// two scales to different replica counts, two applies of different
    /// manifests, or a destroy alongside anything but another destroy.
    ///
    /// Identical actions do not contradict (they agree on the outcome), and
    /// an apply does not contradict a scale: conflicts are keyed on
    /// `(resource, action)`, and those are different actions. Actions on
    /// different resources never contradict. The relation is symmetric.
    pub fn contradicts(&self, other: &Action) -> bool {
        if self.resource() != other.resource() {
            return false;
        }
        match (self, other) {
            (Action::Destroy { .. }, Action::Destroy { .. }) => false,
            (Action::Destroy { .. }, _) | (_, Action::Destroy { .. }) => true,
            (Action::Scale { replicas: a, .. }, Action::Scale { replicas: b, .. }) => a != b,
            (Action::Apply { manifest: a, .. }, Action::Apply { manifest: b, .. }) => a != b,
            (Action::Apply { .. }, Action::Scale { .. })
            | (Action::Scale { .. }, Action::Apply { .. }) => false,
        }
    }
}

/// A short human-readable summary, as recorded in the ledger: `apply web`,
/// `scale web to 5`, `destroy web`. The manifest body is left out.
impl fmt::Display for Action {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Action::Apply { resource, .. } => write!(f, "apply {resource}"),
            Action::Scale { resource, replicas } => write!(f, "scale {resource} to {replicas}"),
            Action::Destroy { resource } => write!(f, "destroy {resource}"),
        }
    }
}

/// How much of the world a change can damage if it goes wrong. Drives both
/// policy (a wider blast radius demands stricter gates) and ordering (serialize
/// the wide ones, parallelize the narrow ones).
///
/// Ordered narrowest to widest, so `Cell < Service < Region < Global`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum BlastRadius {
    /// A single replica or pod.
    Cell,
    /// One service.
    Service,
    /// One region.
    Region,
    /// Everything, everywhere.
    Global,
}

/// Scheduling urgency. Higher variants pass the gate ahead of lower ones.
///
/// Ordered least to most urgent, so `Bulk < Normal < Urgent < Pager`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Priority {
    /// Background reconciliation, batch cleanup.
    Bulk,
    /// Ordinary day-to-day change.
    Normal,
    /// Time-sensitive, but not an outage.
    Urgent,
    /// Incident response - someone is paged.
    Pager,
}

/// A proposed change, fully attributed to the agent that authored it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Intent {
    /// Author-assigned id, monotonic per agent.
    pub id: u64,
    /// Who proposed it.
    pub agent: AgentId,
    /// What it does.
    pub action: Action,
    /// How urgently it wants through.
    pub priority: Priority,
    /// How much it can break.
    pub blast_radius: BlastRadius,
}

impl Intent {
    /// Assemble an intent from its parts.
    pub fn new(
        id: u64,
        agent: AgentId,
        action: Action,
        priority: Priority,
        blast_radius: BlastRadius,
    ) -> Self {
        Self {
            id,
            agent,
            action,
            priority,
            blast_radius,
        }
    }

    /// This intent's identity. Ids are only unique per agent, so an intent
    /// is identified by its agent and id together.
    pub fn key(&self) -> IntentKey {
        IntentKey {
            agent: self.agent.clone(),
            id: self.id,
        }
    }
}

/// Identifies one intent: its agent plus the agent's id for it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct IntentKey {
    /// The agent that authored the intent.
    pub agent: AgentId,
    /// The agent's id for the intent.
    pub id: u64,
}

impl IntentKey {
    /// Identify intent `id` from `agent`.
    pub fn new(agent: impl Into<String>, id: u64) -> Self {
        Self {
            agent: AgentId::new(agent),
            id,
        }
    }
}

/// `agent#id`, e.g. `reconciler-7#42`.
impl fmt::Display for IntentKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}#{}", self.agent, self.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_is_extracted_from_every_action() {
        assert_eq!(
            Action::Apply {
                resource: "web".into(),
                manifest: String::new()
            }
            .resource(),
            "web"
        );
        assert_eq!(
            Action::Scale {
                resource: "api".into(),
                replicas: 3
            }
            .resource(),
            "api"
        );
        assert_eq!(
            Action::Destroy {
                resource: "db".into()
            }
            .resource(),
            "db"
        );
    }

    #[test]
    fn destructive_means_teardown_or_scale_to_zero() {
        assert!(Action::Destroy {
            resource: "x".into()
        }
        .is_destructive());
        assert!(Action::Scale {
            resource: "x".into(),
            replicas: 0
        }
        .is_destructive());
        assert!(!Action::Scale {
            resource: "x".into(),
            replicas: 3
        }
        .is_destructive());
        assert!(!Action::Apply {
            resource: "x".into(),
            manifest: String::new()
        }
        .is_destructive());
    }

    #[test]
    fn actions_summarize_without_the_manifest() {
        let apply = Action::Apply {
            resource: "web".into(),
            manifest: "<large manifest>".into(),
        };
        assert_eq!(apply.to_string(), "apply web");
        let scale = Action::Scale {
            resource: "api".into(),
            replicas: 5,
        };
        assert_eq!(scale.to_string(), "scale api to 5");
        let destroy = Action::Destroy {
            resource: "db".into(),
        };
        assert_eq!(destroy.to_string(), "destroy db");
    }

    #[test]
    fn contradiction_is_keyed_on_resource_and_action() {
        let apply = |r: &str, m: &str| Action::Apply {
            resource: r.into(),
            manifest: m.into(),
        };
        let scale = |r: &str, n: u32| Action::Scale {
            resource: r.into(),
            replicas: n,
        };
        let destroy = |r: &str| Action::Destroy { resource: r.into() };
        let cases = [
            // Same action, different outcome: contradict.
            (scale("web", 3), scale("web", 5), true),
            (apply("web", "v1"), apply("web", "v2"), true),
            // Same action, same outcome: agree.
            (scale("web", 3), scale("web", 3), false),
            (apply("web", "v1"), apply("web", "v1"), false),
            (destroy("web"), destroy("web"), false),
            // A teardown fights with any change to what it tears down.
            (destroy("web"), scale("web", 3), true),
            (destroy("web"), apply("web", "v1"), true),
            // Different actions on one resource: different keys.
            (apply("web", "v1"), scale("web", 3), false),
            // Different resources never contradict.
            (scale("web", 3), scale("api", 5), false),
            (destroy("web"), apply("api", "v1"), false),
        ];
        for (a, b, want) in cases {
            assert_eq!(a.contradicts(&b), want, "{a} vs {b}");
            assert_eq!(b.contradicts(&a), want, "{b} vs {a} (symmetry)");
        }
    }

    #[test]
    fn orderings_run_narrow_to_wide_and_calm_to_urgent() {
        assert!(BlastRadius::Cell < BlastRadius::Global);
        assert!(BlastRadius::Service < BlastRadius::Region);
        assert!(Priority::Bulk < Priority::Pager);
        assert!(Priority::Normal < Priority::Urgent);
    }
}
