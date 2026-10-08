//! Agent identities: who may submit intents, and how to check they did.
//!
//! A [`Keyring`] maps each agent to its Ed25519 public key. Give one to the
//! plane ([`Floodwall::with_keyring`](crate::Floodwall::with_keyring)) and
//! every intent must be signed by its agent's key (see
//! [`Intent`](crate::Intent#signing)); give one to an auditor and they can
//! check every signature in a ledger
//! ([`Ledger::verify_signatures`](crate::Ledger::verify_signatures)). A
//! keyring holds only public keys, so it can be shared freely.

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

/// Each agent's public key.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Keyring {
    keys: BTreeMap<AgentId, VerifyingKey>,
}

impl Keyring {
    /// An empty keyring.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add or replace `agent`'s key. Builder style.
    pub fn with(mut self, agent: impl Into<String>, key: VerifyingKey) -> Self {
        self.insert(agent, key);
        self
    }

    /// Add or replace `agent`'s key, returning the key it replaced.
    pub fn insert(&mut self, agent: impl Into<String>, key: VerifyingKey) -> Option<VerifyingKey> {
        self.keys.insert(AgentId::new(agent), key)
    }

    /// `agent`'s key, if it has one.
    pub fn get(&self, agent: &AgentId) -> Option<&VerifyingKey> {
        self.keys.get(agent)
    }

    /// How many agents have keys.
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    /// Whether no agent has a key.
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Check that `intent` is signed by its agent's key.
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
