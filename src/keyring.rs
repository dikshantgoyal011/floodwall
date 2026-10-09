//! Agent identities: who may submit intents, and how to check they did.
//!
//! A [`Keyring`] maps each agent to its Ed25519 public key. Give one to the
//! plane ([`Floodwall::with_keyring`](crate::Floodwall::with_keyring)) and
//! every intent must be signed by its agent's key (see
//! [`Intent`](crate::Intent#signing)); give one to an auditor and they can
//! check every signature in a ledger
//! ([`Ledger::verify_signatures`](crate::Ledger::verify_signatures)). A
//! keyring holds only public keys, so it can be shared freely.
//!
//! # Rotating keys
//!
//! An agent has one current key, which alone can sign new intents. To
//! rotate, [`insert`](Keyring::insert) the new key and keep the old one with
//! [`with_retired`](Keyring::with_retired): a retired key never
//! authenticates a submission, but still verifies the agent's earlier
//! records in an audit, so a whole-history audit spans the rotation. Leave a
//! compromised key out altogether. Records do not yet carry the time they
//! were written (FW-404), so an audit cannot tell whether a record predates
//! a rotation: a retired key verifies any of its agent's records.
//!
//! Keys are checked when they are created
//! ([`VerifyingKey::from_bytes`]): weak, small-order keys, for which one
//! fixed signature verifies every message, are refused, so they can never
//! be enrolled.

use std::collections::BTreeMap;
use std::fmt;

use crate::ed25519::VerifyingKey;
use crate::intent::{AgentId, Intent};

/// Why an intent's signature was not accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthError {
    /// The intent carries no signature.
    Unsigned,
    /// The keyring has no key for the intent's agent.
    UnknownAgent,
    /// The signature is not the agent's signature of this intent.
    BadSignature,
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            AuthError::Unsigned => "the intent is not signed",
            AuthError::UnknownAgent => "the agent has no key on the keyring",
            AuthError::BadSignature => "the signature is not the agent's signature of this intent",
        })
    }
}

impl std::error::Error for AuthError {}

/// Each agent's current public key, and any retired ones.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Keyring {
    keys: BTreeMap<AgentId, VerifyingKey>,
    retired: BTreeMap<AgentId, Vec<VerifyingKey>>,
}

impl Keyring {
    /// An empty keyring.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add or replace `agent`'s current key. Builder style.
    pub fn with(mut self, agent: impl Into<String>, key: VerifyingKey) -> Self {
        self.insert(agent, key);
        self
    }

    /// Add or replace `agent`'s current key, returning the key it replaced.
    /// The replaced key is dropped; keep it with
    /// [`Keyring::with_retired`] if earlier records still need it.
    pub fn insert(&mut self, agent: impl Into<String>, key: VerifyingKey) -> Option<VerifyingKey> {
        self.keys.insert(AgentId::new(agent), key)
    }

    /// Keep `key` as one of `agent`'s retired keys: accepted when auditing
    /// the agent's records, never for a new submission. Builder style.
    pub fn with_retired(mut self, agent: impl Into<String>, key: VerifyingKey) -> Self {
        let keys = self.retired.entry(AgentId::new(agent)).or_default();
        if !keys.contains(&key) {
            keys.push(key);
        }
        self
    }

    /// `agent`'s current key, if it has one.
    pub fn get(&self, agent: &AgentId) -> Option<&VerifyingKey> {
        self.keys.get(agent)
    }

    /// Every key that may have signed `agent`'s records: the current one
    /// first, then the retired ones in the order they were added.
    pub fn audit_keys<'a>(&'a self, agent: &AgentId) -> impl Iterator<Item = &'a VerifyingKey> {
        self.keys
            .get(agent)
            .into_iter()
            .chain(self.retired.get(agent).into_iter().flatten())
    }

    /// Every agent with a current key, and that key, ordered by agent.
    pub fn iter(&self) -> impl Iterator<Item = (&AgentId, &VerifyingKey)> {
        self.keys.iter()
    }

    /// Every agent with retired keys, and those keys in the order they were
    /// added, ordered by agent.
    pub fn retired(&self) -> impl Iterator<Item = (&AgentId, &[VerifyingKey])> {
        self.retired
            .iter()
            .map(|(agent, keys)| (agent, keys.as_slice()))
    }

    /// How many agents have a current key.
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    /// Whether no agent has a current key.
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Check that `intent` is signed by its agent's current key. Retired keys
    /// do not count here.
    pub fn authenticate(&self, intent: &Intent) -> Result<(), AuthError> {
        if intent.signature.is_none() {
            return Err(AuthError::Unsigned);
        }
        let key = self.get(&intent.agent).ok_or(AuthError::UnknownAgent)?;
        if intent.is_signed_by(key) {
            Ok(())
        } else {
            Err(AuthError::BadSignature)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ed25519::SigningKey;
    use crate::intent::{Action, BlastRadius, Priority};

    fn intent(agent: &str) -> Intent {
        Intent::new(
            1,
            AgentId::new(agent),
            Action::Destroy {
                resource: "web".into(),
            },
            Priority::Normal,
            BlastRadius::Cell,
        )
    }

    #[test]
    fn authenticate_checks_signer_and_agent() {
        let alice = SigningKey::from_seed(&[1; 32]);
        let bob = SigningKey::from_seed(&[2; 32]);
        let ring = Keyring::new()
            .with("alice", alice.verifying_key())
            .with("bob", bob.verifying_key());
        assert_eq!(ring.len(), 2);
        assert!(!ring.is_empty());
        assert_eq!(ring.authenticate(&intent("alice").signed(&alice)), Ok(()));
        assert_eq!(
            ring.authenticate(&intent("alice")),
            Err(AuthError::Unsigned)
        );
        // Bob signing an intent in Alice's name.
        assert_eq!(
            ring.authenticate(&intent("alice").signed(&bob)),
            Err(AuthError::BadSignature)
        );
        assert_eq!(
            ring.authenticate(&intent("carol").signed(&alice)),
            Err(AuthError::UnknownAgent)
        );
    }

    #[test]
    fn keys_can_be_replaced() {
        let old = SigningKey::from_seed(&[1; 32]);
        let new = SigningKey::from_seed(&[3; 32]);
        let mut ring = Keyring::new().with("alice", old.verifying_key());
        assert_eq!(
            ring.insert("alice", new.verifying_key()),
            Some(old.verifying_key())
        );
        assert_eq!(ring.get(&AgentId::new("alice")), Some(&new.verifying_key()));
        assert_eq!(
            ring.authenticate(&intent("alice").signed(&old)),
            Err(AuthError::BadSignature)
        );
        assert_eq!(ring.authenticate(&intent("alice").signed(&new)), Ok(()));
        assert!(Keyring::new().is_empty());
    }

    #[test]
    fn errors_read_plainly() {
        assert_eq!(AuthError::Unsigned.to_string(), "the intent is not signed");
        assert_eq!(
            AuthError::UnknownAgent.to_string(),
            "the agent has no key on the keyring"
        );
        assert_eq!(
            AuthError::BadSignature.to_string(),
            "the signature is not the agent's signature of this intent"
        );
    }
}
