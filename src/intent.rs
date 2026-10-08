//! The unit of work.
//!
//! An [`Intent`] is a change an agent wants to make to live infrastructure. In
//! the floodwall model agents never touch production directly - they press
//! their Intents against the wall, and the control plane decides what passes
//! through the gate.

use std::fmt;

use crate::ed25519::{Signature, SigningKey, VerifyingKey};
use crate::ledger::Digest;
use crate::sha256::Sha256;

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
    // The explicit values are part of the signed intent encoding (see
    // `Intent::digest`); do not change them.
    /// A single replica or pod.
    Cell = 0,
    /// One service.
    Service = 1,
    /// One region.
    Region = 2,
    /// Everything, everywhere.
    Global = 3,
}

/// Scheduling urgency. Higher variants pass the gate ahead of lower ones.
///
/// Ordered least to most urgent, so `Bulk < Normal < Urgent < Pager`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Priority {
    // The explicit values are part of the signed intent encoding (see
    // `Intent::digest`); do not change them.
    /// Background reconciliation, batch cleanup.
    Bulk = 0,
    /// Ordinary day-to-day change.
    Normal = 1,
    /// Time-sensitive, but not an outage.
    Urgent = 2,
    /// Incident response - someone is paged.
    Pager = 3,
}

/// A proposed change, fully attributed to the agent that authored it.
///
/// # Signing
///
/// An agent proves it authored an intent by signing the intent's
/// [`digest`](Intent::digest) with its Ed25519 key ([`Intent::signed`]).
/// The digest covers every field except the signature itself, so changing
/// anything about a signed intent invalidates its signature. The digest is
/// SHA-256 over these bytes, where integers are little-endian and a *field*
/// is its length in bytes as a `u64` followed by the bytes:
///
/// 1. the field `floodwall/intent/v1`;
/// 2. the field `agent`, as UTF-8, then `id` as a `u64`;
/// 3. the action: the byte `0` for `Apply` followed by the fields
///    `resource` and `manifest`; `1` for `Scale` followed by the field
///    `resource` and `replicas` as a `u32`; `2` for `Destroy` followed by
///    the field `resource`;
/// 4. the priority as one byte: `Bulk` 0, `Normal` 1, `Urgent` 2, `Pager` 3;
/// 5. the blast radius as one byte: `Cell` 0, `Service` 1, `Region` 2,
///    `Global` 3.
///
/// The signature is Ed25519 over the 32 digest bytes.
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
    /// The agent's signature of the intent's digest, if it signed it.
    pub signature: Option<Signature>,
}

impl Intent {
    /// Assemble an unsigned intent from its parts.
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
            signature: None,
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

    /// The SHA-256 digest an agent signs, over every field but the
    /// signature (see [Signing](Intent#signing)).
    pub fn digest(&self) -> Digest {
        let field = |h: &mut Sha256, bytes: &[u8]| {
            h.update(&(bytes.len() as u64).to_le_bytes());
            h.update(bytes);
        };
        let mut h = Sha256::new();
        field(&mut h, b"floodwall/intent/v1");
        field(&mut h, self.agent.as_str().as_bytes());
        h.update(&self.id.to_le_bytes());
        match &self.action {
            Action::Apply { resource, manifest } => {
                h.update(&[0]);
                field(&mut h, resource.as_bytes());
                field(&mut h, manifest.as_bytes());
            }
            Action::Scale { resource, replicas } => {
                h.update(&[1]);
                field(&mut h, resource.as_bytes());
                h.update(&replicas.to_le_bytes());
            }
            Action::Destroy { resource } => {
                h.update(&[2]);
                field(&mut h, resource.as_bytes());
            }
        }
        h.update(&[self.priority as u8, self.blast_radius as u8]);
        Digest(h.finalize())
    }

    /// This intent, signed with `key`. Any previous signature is replaced.
    pub fn signed(mut self, key: &SigningKey) -> Self {
        self.signature = Some(key.sign(self.digest().as_bytes()));
        self
    }

    /// Whether the intent carries a valid signature by `key`.
    pub fn is_signed_by(&self, key: &VerifyingKey) -> bool {
        self.signature
            .is_some_and(|sig| key.verify(self.digest().as_bytes(), &sig))
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

    fn deploy() -> Intent {
        Intent::new(
            7,
            AgentId::new("deployer"),
            Action::Apply {
                resource: "web".into(),
                manifest: "v2".into(),
            },
            Priority::Urgent,
            BlastRadius::Service,
        )
    }

    #[test]
    fn the_digest_follows_the_documented_encoding() {
        // From an independent implementation written from the "Signing"
        // docs, with Node's Ed25519 signing the digest under seed [7; 32].
        assert_eq!(
            deploy().digest().to_string(),
            "556b2fe4c7dd796f82d2ab8021bd546abc6e29ab4303f192ea18d4333fc36b9d"
        );
        let scale = Intent::new(
            8,
            AgentId::new("autoscaler"),
            Action::Scale {
                resource: "web".into(),
                replicas: 3,
            },
            Priority::Normal,
            BlastRadius::Cell,
        );
        assert_eq!(
            scale.digest().to_string(),
            "40c7c9420da6945fa376be65f3712b6ed281a8c87b4b95f9d1dc2043335a14da"
        );
        let signed = deploy().signed(&SigningKey::from_seed(&[7; 32]));
        assert_eq!(
            signed.signature.unwrap().to_string(),
            "2379a35c279cd1952912648e0d19951e1630a9c7e2e5edb3a5c25f0223c9edd5dd317afbd86ffa02710c89164276dcd65aea84a351c7c39d9bfba89b4a532105"
        );
        // The signature is not part of the digest.
        assert_eq!(signed.digest(), deploy().digest());
    }

    #[test]
    fn a_signature_covers_every_field() {
        let key = SigningKey::from_seed(&[7; 32]);
        let vk = key.verifying_key();
        let signed = deploy().signed(&key);
        assert!(signed.is_signed_by(&vk));
        assert!(!deploy().is_signed_by(&vk), "unsigned");
        assert!(!signed.is_signed_by(&SigningKey::from_seed(&[8; 32]).verifying_key()));

        let edits: [fn(&mut Intent); 9] = [
            |i| i.id += 1,
            |i| i.agent = AgentId::new("deployer2"),
            |i| i.priority = Priority::Pager,
            |i| i.blast_radius = BlastRadius::Global,
            |i| {
                if let Action::Apply { manifest, .. } = &mut i.action {
                    manifest.push('!');
                }
            },
            |i| {
                if let Action::Apply { resource, .. } = &mut i.action {
                    *resource = "api".into();
                }
            },
            |i| {
                i.action = Action::Destroy {
                    resource: "web".into(),
                }
            },
            |i| {
                i.action = Action::Scale {
                    resource: "web".into(),
                    replicas: 2,
                }
            },
            |i| {
                // Same bytes, different boundary: resource "webv" + manifest "2".
                i.action = Action::Apply {
                    resource: "webv".into(),
                    manifest: "2".into(),
                }
            },
        ];
        for (n, edit) in edits.iter().enumerate() {
            let mut tampered = signed.clone();
            edit(&mut tampered);
            assert!(
                !tampered.is_signed_by(&vk),
                "edit {n} kept the signature valid"
            );
        }
        // Re-signing replaces the old signature.
        let mut changed = signed.clone();
        changed.priority = Priority::Pager;
        assert!(changed.signed(&key).is_signed_by(&vk));
    }

    #[test]
    fn scale_replicas_are_all_covered() {
        let scale = |n| {
            Intent::new(
                1,
                AgentId::new("a"),
                Action::Scale {
                    resource: "web".into(),
                    replicas: n,
                },
                Priority::Normal,
                BlastRadius::Cell,
            )
            .digest()
        };
        assert_ne!(scale(1), scale(1 << 24), "the high byte of replicas counts");
    }

    #[test]
    fn orderings_run_narrow_to_wide_and_calm_to_urgent() {
        assert!(BlastRadius::Cell < BlastRadius::Global);
        assert!(BlastRadius::Service < BlastRadius::Region);
        assert!(Priority::Bulk < Priority::Pager);
        assert!(Priority::Normal < Priority::Urgent);
    }
}
