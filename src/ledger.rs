//! Tamper-evident provenance.
//!
//! Every decision the floodwall makes is appended to a hash chain: each
//! record's digest folds in the previous record's digest, so any retroactive
//! edit to history breaks the chain from that point forward. [`Ledger::verify`]
//! recomputes the whole chain and confirms nothing has been altered.
//!
//! The digest is SHA-256 ([`crate::sha256`]), so the chain holds against a
//! motivated adversary, not just accidental corruption: changing a record
//! without breaking the chain means finding a SHA-256 collision.
//!
//! # Record encoding
//!
//! A record's [`Digest`] is SHA-256 over these bytes, in order. Integers are
//! little-endian. A *field* is its length in bytes as a `u64`, then the bytes,
//! so field boundaries are unambiguous (`"ab" + "c"` never hashes like
//! `"a" + "bc"`).
//!
//! 1. the field `floodwall/ledger/record/v2` (domain separation, so a record
//!    digest is never mistaken for any other hash the crate computes);
//! 2. `prev`: the previous record's digest, 32 bytes ([`Digest::GENESIS`],
//!    all zeros, for the first record);
//! 3. `seq` as a `u64`;
//! 4. `intent_id` as a `u64`;
//! 5. the intent's [digest](crate::Intent::digest): the byte `0` if the
//!    record is not about an intent, or the byte `1` followed by the 32-byte
//!    digest of [`Record::intent`];
//! 6. the intent's signature: the byte `0` if there is none, or the byte `1`
//!    followed by the 64-byte signature;
//! 7. the fields `agent`, `verdict` and `evidence.action`, as UTF-8;
//! 8. `evidence.reason`: the byte `0` if there is none, or the byte `1`
//!    followed by the reason as a field;
//! 9. the number of `evidence.policies` as a `u64`, then for each, its name
//!    and its label as fields.
//!
//! # Signatures
//!
//! A record about an intent stores the intent itself ([`Record::intent`]),
//! as the agent signed it. The record's `intent_id`, `agent` and
//! `evidence.action` are taken from that intent, never supplied separately,
//! and [`Ledger::verify`] rejects a record whose fields disagree with its
//! intent. The intent's digest and signature are covered by the record's own
//! digest.
//!
//! With the agents' public keys, [`Ledger::verify_signatures`] recomputes
//! each stored intent's digest and checks the agent's signature of it. So a
//! verified record proves its agent asked for exactly the change the record
//! shows: changing what an agent asked for, attributing it to another agent,
//! or claiming it asked for something it never signed, all fail.

use std::fmt;

use crate::ed25519::Signature;
use crate::intent::Intent;
use crate::keyring::Keyring;
use crate::sha256::Sha256;

/// A SHA-256 digest: one record's fingerprint, or the head of the chain.
/// Displays as 64 lowercase hex digits.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Digest(pub [u8; 32]);

impl Digest {
    /// The `prev` of the first record, and the head of an empty ledger: 32
    /// zero bytes.
    pub const GENESIS: Digest = Digest([0; 32]);

    /// The digest's bytes.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Display for Digest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for Digest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Digest({self})")
    }
}

const RECORD_DOMAIN: &[u8] = b"floodwall/ledger/record/v2";

/// Feed one variable-length field: its length, then its bytes.
fn field(h: &mut Sha256, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

/// Why a decision came out the way it did, recorded alongside the verdict.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Evidence {
    /// A short summary of the change, e.g. `scale web to 5`.
    pub action: String,
    /// The combined verdict's reason, for a `reject` or `defer`.
    pub reason: Option<String>,
    /// Each policy's name and its verdict label, in evaluation order.
    pub policies: Vec<(String, String)>,
}

/// One immutable decision in the chain.
#[derive(Clone, Debug)]
pub struct Record {
    /// Position in the chain, from 0.
    pub seq: u64,
    /// The intent that was ruled on.
    pub intent_id: u64,
    /// The intent itself, as its agent submitted (and signed) it, for a
    /// record written about an intent. When present, `intent_id`, `agent`
    /// and `evidence.action` must agree with it.
    pub intent: Option<Intent>,
    /// The agent that authored the intent.
    pub agent: String,
    /// What happened to the intent. A decision is `admit`, `defer` (held)
    /// or `reject`; afterwards an admitted intent is `succeeded` or
    /// `failed`, and a held one is `released` or `expired`.
    pub verdict: String,
    /// What the change was and why it got this verdict.
    pub evidence: Evidence,
    /// Digest of the previous record - the chain link.
    pub prev: Digest,
    /// Digest of this record.
    pub digest: Digest,
}

impl Record {
    /// Recompute this record's digest from its contents (every field but
    /// `digest` itself), as described in [Record encoding](self#record-encoding).
    pub fn compute_digest(&self) -> Digest {
        let mut h = Sha256::new();
        field(&mut h, RECORD_DOMAIN);
        h.update(self.prev.as_bytes());
        h.update(&self.seq.to_le_bytes());
        h.update(&self.intent_id.to_le_bytes());
        match self.intent_digest() {
            None => h.update(&[0]),
            Some(d) => {
                h.update(&[1]);
                h.update(d.as_bytes());
            }
        }
        match self.signature() {
            None => h.update(&[0]),
            Some(sig) => {
                h.update(&[1]);
                h.update(sig.as_bytes());
            }
        }
        field(&mut h, self.agent.as_bytes());
        field(&mut h, self.verdict.as_bytes());
        field(&mut h, self.evidence.action.as_bytes());
        match &self.evidence.reason {
            None => h.update(&[0]),
            Some(reason) => {
                h.update(&[1]);
                field(&mut h, reason.as_bytes());
            }
        }
        h.update(&(self.evidence.policies.len() as u64).to_le_bytes());
        for (name, label) in &self.evidence.policies {
            field(&mut h, name.as_bytes());
            field(&mut h, label.as_bytes());
        }
        Digest(h.finalize())
    }

    /// The digest of the record's intent, if it is about one.
    pub fn intent_digest(&self) -> Option<Digest> {
        self.intent.as_ref().map(Intent::digest)
    }

    /// The agent's signature of the record's intent, if it signed it.
    pub fn signature(&self) -> Option<Signature> {
        self.intent.as_ref().and_then(|i| i.signature)
    }

    /// Whether the record's `intent_id`, `agent` and `evidence.action` are
    /// the ones its intent gives. Always true for a record not about an
    /// intent.
    pub fn agrees_with_intent(&self) -> bool {
        self.intent.as_ref().is_none_or(|i| {
            self.intent_id == i.id
                && self.agent == i.agent.as_str()
                && self.evidence.action == i.action.to_string()
        })
    }
}

/// What is wrong with a record's signature.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignatureProblem {
    /// The record is not about a specific intent, so there is nothing signed.
    NoIntent,
    /// The record's intent was not signed.
    Unsigned,
    /// The keyring has no key for the record's agent.
    UnknownAgent,
    /// The record's intent id, agent or action disagrees with its intent.
    Mismatch,
    /// The signature is not the agent's signature of the record's intent.
    BadSignature,
}

/// [`Ledger::verify_signatures`] found a record whose authorship cannot be
/// proven.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignatureError {
    /// The record's position in the chain.
    pub seq: u64,
    /// What is wrong with it.
    pub problem: SignatureProblem,
}

impl fmt::Display for SignatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let problem = match self.problem {
            SignatureProblem::NoIntent => "is not about a signed intent",
            SignatureProblem::Unsigned => "is about an unsigned intent",
            SignatureProblem::UnknownAgent => "names an agent with no key on the keyring",
            SignatureProblem::Mismatch => "shows a different request from the intent it holds",
            SignatureProblem::BadSignature => {
                "carries a signature that does not match its agent and intent"
            }
        };
        write!(f, "record {} {problem}", self.seq)
    }
}

impl std::error::Error for SignatureError {}

/// An append-only, hash-chained log of decisions.
pub struct Ledger {
    records: Vec<Record>,
    head: Digest,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::new()
    }
}

impl Ledger {
    /// An empty ledger, whose head is [`Digest::GENESIS`].
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
            head: Digest::GENESIS,
        }
    }

    /// Append a decision with no evidence and return the record just written.
    pub fn append(&mut self, intent_id: u64, agent: &str, verdict: &str) -> &Record {
        self.append_with(intent_id, agent, verdict, Evidence::default())
    }

    /// Append what happened to `intent`, with the verdict's reason and each
    /// policy's verdict, and return the record just written. The record
    /// stores the intent, signature and all, and takes its intent id, agent
    /// and action summary from it, so what the record shows is exactly what
    /// the agent asked for.
    pub fn append_intent(
        &mut self,
        intent: &Intent,
        verdict: &str,
        reason: Option<String>,
        policies: Vec<(String, String)>,
    ) -> &Record {
        let evidence = Evidence {
            action: intent.action.to_string(),
            reason,
            policies,
        };
        self.push(
            intent.id,
            Some(intent.clone()),
            intent.agent.as_str(),
            verdict,
            evidence,
        )
    }

    /// Append a decision together with its evidence and return the record
    /// just written. The evidence is covered by the digest, so editing it
    /// later breaks the chain just like editing the verdict.
    pub fn append_with(
        &mut self,
        intent_id: u64,
        agent: &str,
        verdict: &str,
        evidence: Evidence,
    ) -> &Record {
        self.push(intent_id, None, agent, verdict, evidence)
    }

    fn push(
        &mut self,
        intent_id: u64,
        intent: Option<Intent>,
        agent: &str,
        verdict: &str,
        evidence: Evidence,
    ) -> &Record {
        let mut record = Record {
            seq: self.records.len() as u64,
            intent_id,
            intent,
            agent: agent.to_string(),
            verdict: verdict.to_string(),
            evidence,
            prev: self.head,
            digest: Digest::GENESIS,
        };
        record.digest = record.compute_digest();
        self.head = record.digest;
        self.records.push(record);
        self.records.last().expect("a record was just pushed")
    }

    /// Recompute the chain from genesis and confirm nothing has been
    /// altered: every record is at its position, links to the one before
    /// it, agrees with the intent it holds, and has the digest its contents
    /// give, and the last digest is the head.
    pub fn verify(&self) -> bool {
        let mut prev = Digest::GENESIS;
        for (i, r) in self.records.iter().enumerate() {
            if r.seq != i as u64
                || r.prev != prev
                || !r.agrees_with_intent()
                || r.compute_digest() != r.digest
            {
                return false;
            }
            prev = r.digest;
        }
        prev == self.head
    }

    /// Check every record's authorship against the agents' public keys:
    /// each record must hold an intent, agree with it (the same intent id,
    /// agent and action), and carry a signature of that intent's recomputed
    /// digest by one of the keys `keyring` holds for the agent, current or
    /// retired (see [`Keyring::with_retired`]). Returns how many records
    /// were checked, or the first record that fails. This proves
    /// authorship; use [`Ledger::verify`] for the chain itself.
    pub fn verify_signatures(&self, keyring: &Keyring) -> Result<usize, SignatureError> {
        for r in &self.records {
            let fail = |problem| SignatureError {
                seq: r.seq,
                problem,
            };
            let intent = r.intent.as_ref().ok_or(fail(SignatureProblem::NoIntent))?;
            let sig = intent.signature.ok_or(fail(SignatureProblem::Unsigned))?;
            if !r.agrees_with_intent() {
                return Err(fail(SignatureProblem::Mismatch));
            }
            let mut keys = keyring.audit_keys(&intent.agent).peekable();
            if keys.peek().is_none() {
                return Err(fail(SignatureProblem::UnknownAgent));
            }
            let digest = intent.digest();
            if !keys.any(|key| key.verify(digest.as_bytes(), &sig)) {
                return Err(fail(SignatureProblem::BadSignature));
            }
        }
        Ok(self.records.len())
    }

    /// The current head digest - a fingerprint of the entire history.
    pub fn head(&self) -> Digest {
        self.head
    }

    /// The recorded decisions, oldest first.
    pub fn records(&self) -> &[Record] {
        &self.records
    }

    /// How many decisions are recorded.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// Whether the ledger is empty.
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ed25519::SigningKey;
    use crate::intent::{Action, AgentId, BlastRadius, Priority};

    #[test]
    fn empty_ledger_verifies() {
        let l = Ledger::new();
        assert!(l.is_empty());
        assert!(l.verify());
        assert_eq!(l.head(), Digest::GENESIS);
    }

    #[test]
    fn appending_links_the_chain() {
        let mut l = Ledger::new();
        let first = l.head();
        l.append(1, "bot", "admit");
        let second = l.head();
        l.append(2, "bot", "reject");
        assert_eq!(l.len(), 2);
        assert!(l.verify());
        // Head advances with every append.
        assert_ne!(first, second);
        assert_ne!(second, l.head());
        // Each record links to the one before it.
        assert_eq!(l.records()[1].prev, l.records()[0].digest);
    }

    #[test]
    fn tampering_breaks_verification() {
        let mut l = Ledger::new();
        l.append(1, "bot", "admit");
        l.append(2, "bot", "admit");
        l.append(3, "bot", "reject");
        assert!(l.verify());
        // Rewrite history: flip a recorded verdict without recomputing digests.
        // The test module can reach the private field; production code cannot.
        l.records[1].verdict = "reject".to_string();
        assert!(!l.verify());
    }

    fn evidence(reason: Option<&str>) -> Evidence {
        Evidence {
            action: "destroy web".into(),
            reason: reason.map(Into::into),
            policies: vec![
                ("no-global-destroy".into(), "reject".into()),
                ("resource-allowlist".into(), "admit".into()),
            ],
        }
    }

    #[test]
    fn evidence_is_recorded_and_covered_by_the_digest() {
        let mut l = Ledger::new();
        let r = l.append_with(1, "bot", "reject", evidence(Some("no humans")));
        assert_eq!(r.evidence.action, "destroy web");
        assert_eq!(r.evidence.reason.as_deref(), Some("no humans"));
        assert_eq!(r.evidence.policies.len(), 2);
        assert!(l.verify());

        // Editing any part of the evidence breaks the chain.
        let mut edited = l.records.clone();
        edited[0].evidence.reason = Some("approved".into());
        assert!(!Ledger {
            records: edited,
            head: l.head
        }
        .verify());

        let mut edited = l.records.clone();
        edited[0].evidence.policies[0].1 = "admit".into();
        assert!(!Ledger {
            records: edited,
            head: l.head
        }
        .verify());

        let mut edited = l.records.clone();
        edited[0].evidence.action = "scale web to 3".into();
        assert!(!Ledger {
            records: edited,
            head: l.head
        }
        .verify());
    }

    #[test]
    fn no_reason_and_empty_reason_hash_differently() {
        let mut a = Ledger::new();
        a.append_with(1, "bot", "admit", evidence(None));
        let mut b = Ledger::new();
        b.append_with(1, "bot", "admit", evidence(Some("")));
        assert_ne!(a.head(), b.head());
    }

    /// The ledger the documented encoding was checked against.
    fn reference_ledger() -> Ledger {
        let mut l = Ledger::new();
        l.append_with(
            1,
            "reconciler-7",
            "admit",
            Evidence {
                action: "scale web to 5".into(),
                reason: None,
                policies: vec![
                    ("no-global-destroy".into(), "admit".into()),
                    ("conflict-window".into(), "admit".into()),
                ],
            },
        );
        l.append_with(
            2,
            "deployer",
            "defer",
            Evidence {
                action: "apply billing".into(),
                reason: Some("resource 'billing' is not on the allowlist".into()),
                policies: vec![("resource-allowlist".into(), "defer".into())],
            },
        );
        // Non-ASCII: lengths are in bytes, not characters.
        l.append(3, "opérateur", "released");
        l.append_with(
            3,
            "opérateur",
            "admit",
            Evidence {
                reason: Some(String::new()),
                ..Evidence::default()
            },
        );
        // A record about a signed intent, and one about an unsigned intent.
        // Their action summaries ("apply web", "scale web to 3") come from
        // the intents themselves.
        l.append_intent(&signed_intent(), "admit", None, vec![]);
        l.append_intent(&unsigned_intent(), "succeeded", None, vec![]);
        l
    }

    fn deployer_key() -> SigningKey {
        SigningKey::from_seed(&[7; 32])
    }

    fn signed_intent() -> Intent {
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
        .signed(&deployer_key())
    }

    fn unsigned_intent() -> Intent {
        Intent::new(
            8,
            AgentId::new("autoscaler"),
            Action::Scale {
                resource: "web".into(),
                replicas: 3,
            },
            Priority::Normal,
            BlastRadius::Cell,
        )
    }

    #[test]
    fn digests_follow_the_documented_encoding() {
        // Computed by an independent implementation (Node's crypto) written
        // from the "Record encoding" section of this module's docs and the
        // "Signing" section of `Intent`'s, with Node's Ed25519 signature.
        let want = [
            "7a6771f4ee960f9a5fe1ebc497739dc56be2796637aadae8163cd85601e911af",
            "a173989be6337d02b7e61b89ee26bd0a35dc091a4d50bf248ef8c4f0ce32cf32",
            "42a5d402e0e778bb13e852befc5d1929393991ee41f6dec6a606c2005dae522e",
            "312d24135327af062fdc660ce27a0ebc3a84fae9b3b7f6dbee6a085d6084d086",
            "006b530eb9c1a079b0668a7646e282839145d59540ee26b401ea72fd51d2dd97",
            "2af252fa07da44c62bc9f1cf9fa66a9e9eb6a28a19d718a406453a33fbd0105c",
        ];
        let l = reference_ledger();
        let got: Vec<String> = l.records().iter().map(|r| r.digest.to_string()).collect();
        assert_eq!(got, want);
        assert_eq!(l.head().to_string(), want[5]);
        assert!(l.verify());
        let signed = &l.records()[4];
        assert_eq!(signed.intent.as_ref(), Some(&signed_intent()));
        assert_eq!(signed.evidence.action, "apply web");
        assert_eq!(
            signed.intent_digest().unwrap().to_string(),
            "556b2fe4c7dd796f82d2ab8021bd546abc6e29ab4303f192ea18d4333fc36b9d"
        );
        assert_eq!(
            signed.signature().unwrap().to_string(),
            "2379a35c279cd1952912648e0d19951e1630a9c7e2e5edb3a5c25f0223c9edd5dd317afbd86ffa02710c89164276dcd65aea84a351c7c39d9bfba89b4a532105"
        );
        assert_eq!(l.records()[5].signature(), None);
        assert_eq!(l.records()[5].evidence.action, "scale web to 3");
        assert_eq!(l.records()[0].intent_digest(), None);
    }

    #[test]
    fn genesis_is_all_zeros_and_digests_print_as_hex() {
        assert_eq!(Digest::GENESIS.to_string(), "0".repeat(64));
        assert_eq!(Ledger::new().head(), Digest::GENESIS);
        let l = reference_ledger();
        assert_eq!(l.records()[0].prev, Digest::GENESIS);
        let d = l.records()[0].digest;
        assert_eq!(d.as_bytes()[0], 0x7a);
        assert_eq!(format!("{d:?}"), format!("Digest({d})"));
    }

    /// A ledger whose every record is about an intent signed by its agent.
    fn signed_ledger() -> (Ledger, Keyring) {
        let autoscaler = SigningKey::from_seed(&[8; 32]);
        let keyring = Keyring::new()
            .with("deployer", deployer_key().verifying_key())
            .with("autoscaler", autoscaler.verifying_key());
        let mut l = Ledger::new();
        l.append_intent(&signed_intent(), "admit", None, vec![]);
        l.append_intent(
            &unsigned_intent().signed(&autoscaler),
            "defer",
            Some("resource 'web' is busy".into()),
            vec![("conflict-window".into(), "defer".into())],
        );
        l.append_intent(&signed_intent(), "succeeded", None, vec![]);
        (l, keyring)
    }

    #[test]
    fn signatures_verify_against_the_agents_public_keys() {
        let (l, keyring) = signed_ledger();
        assert!(l.verify());
        assert_eq!(l.verify_signatures(&keyring), Ok(3));
    }

    #[test]
    fn records_without_proof_of_authorship_fail_signature_checks() {
        let (_, keyring) = signed_ledger();
        let problem = |l: &Ledger| {
            l.verify_signatures(&keyring)
                .map_err(|e| (e.seq, e.problem))
        };

        // A record not about an intent, and one about an unsigned intent.
        let reference = reference_ledger();
        assert_eq!(problem(&reference), Err((0, SignatureProblem::NoIntent)));
        let mut l = Ledger::new();
        l.append_intent(&signed_intent(), "admit", None, vec![]);
        l.append_intent(&unsigned_intent(), "admit", None, vec![]);
        assert_eq!(problem(&l), Err((1, SignatureProblem::Unsigned)));

        // An agent the auditor has no key for.
        let mut l = Ledger::new();
        let stranger = SigningKey::from_seed(&[9; 32]);
        let mut intent = unsigned_intent();
        intent.agent = AgentId::new("stranger");
        l.append_intent(&intent.signed(&stranger), "admit", None, vec![]);
        assert_eq!(problem(&l), Err((0, SignatureProblem::UnknownAgent)));
    }

    #[test]
    fn a_signature_cannot_be_moved_or_its_intent_changed() {
        let (l, keyring) = signed_ledger();
        // Rewrite whole chains consistently, so verify() passes and only
        // the signatures can tell.
        let rechain = |mut records: Vec<Record>| {
            let mut prev = Digest::GENESIS;
            for r in &mut records {
                r.prev = prev;
                r.digest = r.compute_digest();
                prev = r.digest;
            }
            Ledger {
                records,
                head: prev,
            }
        };
        let bad = |l: &Ledger| {
            assert!(l.verify(), "the rewritten chain is consistent");
            l.verify_signatures(&keyring)
                .map_err(|e| (e.seq, e.problem))
        };

        // Claim the deployer asked for something else: same summary, but a
        // different manifest than the one it signed.
        let mut records = l.records.clone();
        records[0].intent.as_mut().unwrap().action = Action::Apply {
            resource: "web".into(),
            manifest: "v3".into(),
        };
        assert_eq!(
            bad(&rechain(records)),
            Err((0, SignatureProblem::BadSignature))
        );

        // Move the deployer's signature onto the autoscaler's record.
        let mut records = l.records.clone();
        let deployer_sig = records[0].signature();
        records[1].intent.as_mut().unwrap().signature = deployer_sig;
        assert_eq!(
            bad(&rechain(records)),
            Err((1, SignatureProblem::BadSignature))
        );

        // Attribute the deployer's signed intent to the autoscaler, record
        // and intent alike.
        let mut records = l.records.clone();
        records[2].agent = "autoscaler".into();
        records[2].intent.as_mut().unwrap().agent = AgentId::new("autoscaler");
        assert_eq!(
            bad(&rechain(records)),
            Err((2, SignatureProblem::BadSignature))
        );

        // And without rewriting the chain, any edit to the signature breaks
        // the chain itself.
        let mut records = l.records.clone();
        records[0]
            .intent
            .as_mut()
            .unwrap()
            .signature
            .as_mut()
            .unwrap()
            .0[0] ^= 1;
        let forged = Ledger {
            records,
            head: l.head,
        };
        assert!(!forged.verify());
    }

    #[test]
    fn a_record_cannot_show_a_different_request_from_its_intent() {
        // Review repro on PR #13: a valid signed Scale(web, 5) recorded as
        // "destroy database". append_intent no longer takes a separate
        // action, so the record shows what was signed...
        let key = deployer_key();
        let scale = Intent::new(
            1,
            AgentId::new("deployer"),
            Action::Scale {
                resource: "web".into(),
                replicas: 5,
            },
            Priority::Normal,
            BlastRadius::Service,
        )
        .signed(&key);
        let mut l = Ledger::new();
        let r = l.append_intent(&scale, "admit", None, vec![]);
        assert_eq!(r.evidence.action, "scale web to 5");
        assert_eq!((r.intent_id, r.agent.as_str()), (1, "deployer"));
        let keyring = Keyring::new().with("deployer", key.verifying_key());
        assert_eq!(l.verify_signatures(&keyring), Ok(1));

        // ...and a record rewritten to disagree with its intent, even with a
        // consistent chain and the original valid signature, fails both
        // checks: the action, the agent or the intent id.
        let edits: [fn(&mut Record); 3] = [
            |r| r.evidence.action = "destroy database".into(),
            |r| r.agent = "autoscaler".into(),
            |r| r.intent_id = 2,
        ];
        for edit in edits {
            let mut records = l.records.clone();
            edit(&mut records[0]);
            records[0].digest = records[0].compute_digest();
            let forged = Ledger {
                head: records[0].digest,
                records,
            };
            assert!(!forged.records[0].agrees_with_intent());
            assert!(!forged.verify());
            assert_eq!(
                forged.verify_signatures(&keyring).map_err(|e| e.problem),
                Err(SignatureProblem::Mismatch)
            );
        }
    }

    #[test]
    fn retired_keys_verify_earlier_records_but_never_new_ones() {
        let old = deployer_key();
        let new = SigningKey::from_seed(&[70; 32]);
        let mut l = Ledger::new();
        l.append_intent(&signed_intent(), "admit", None, vec![]);
        let mut later = signed_intent();
        later.id = 8;
        l.append_intent(&later.clone().signed(&new), "admit", None, vec![]);

        // After rotating to the new key, the first record needs the old one.
        let rotated = Keyring::new().with("deployer", new.verifying_key());
        assert_eq!(
            l.verify_signatures(&rotated)
                .map_err(|e| (e.seq, e.problem)),
            Err((0, SignatureProblem::BadSignature))
        );
        let with_history = rotated.with_retired("deployer", old.verifying_key());
        assert_eq!(l.verify_signatures(&with_history), Ok(2));
        // A retired key does not authenticate new submissions.
        assert!(with_history.authenticate(&signed_intent()).is_err());
        assert!(with_history.authenticate(&later.signed(&new)).is_ok());
    }

    #[test]
    fn signature_errors_say_which_record_and_why() {
        let e = SignatureError {
            seq: 4,
            problem: SignatureProblem::BadSignature,
        };
        assert_eq!(
            e.to_string(),
            "record 4 carries a signature that does not match its agent and intent"
        );
        let e = SignatureError {
            seq: 2,
            problem: SignatureProblem::Mismatch,
        };
        assert_eq!(
            e.to_string(),
            "record 2 shows a different request from the intent it holds"
        );
    }

    /// A named way to tamper with one field of a record.
    type FieldEdit = (&'static str, fn(&mut Record));

    #[test]
    fn changing_any_field_breaks_verification() {
        let l = reference_ledger();
        let edits: Vec<FieldEdit> = vec![
            ("seq", |r| r.seq += 1),
            ("intent_id", |r| r.intent_id += 1),
            ("agent", |r| r.agent.push('x')),
            ("verdict", |r| r.verdict = "admit".into()),
            ("action", |r| r.evidence.action.push('x')),
            ("reason", |r| r.evidence.reason = Some("forged".into())),
            ("policy name", |r| r.evidence.policies[0].0.push('x')),
            ("policy label", |r| {
                r.evidence.policies[0].1 = "admit".into()
            }),
            ("policy dropped", |r| {
                r.evidence.policies.pop();
            }),
            ("prev", |r| r.prev.0[0] ^= 1),
            ("digest", |r| r.digest.0[31] ^= 1),
        ];
        for (what, edit) in edits {
            let mut records = l.records.clone();
            edit(&mut records[1]);
            let forged = Ledger {
                records,
                head: l.head,
            };
            assert!(!forged.verify(), "editing {what} went unnoticed");
        }
    }

    #[test]
    fn a_consistently_rewritten_chain_still_disagrees_with_the_head() {
        // Edit a record and recompute every digest after it: the chain is
        // internally consistent again, but no longer ends at the head.
        let l = reference_ledger();
        let mut records = l.records.clone();
        records[1].verdict = "admit".into();
        let mut prev = records[0].digest;
        for r in &mut records[1..] {
            r.prev = prev;
            r.digest = r.compute_digest();
            prev = r.digest;
        }
        let forged = Ledger {
            records,
            head: l.head,
        };
        assert!(!forged.verify());
    }

    #[test]
    fn rewriting_one_record_with_a_valid_digest_breaks_the_next_link() {
        // Edit a middle record and give it a correct digest for its new
        // contents, leaving everything after it alone. The record checks
        // out on its own, and the head is untouched; only the next record's
        // link to it gives the forgery away.
        let l = reference_ledger();
        let mut records = l.records.clone();
        records[1].verdict = "admit".into();
        records[1].digest = records[1].compute_digest();
        let forged = Ledger {
            records,
            head: l.head,
        };
        assert_eq!(forged.records[1].compute_digest(), forged.records[1].digest);
        assert_eq!(forged.records.last().unwrap().digest, forged.head);
        assert!(!forged.verify());
    }

    #[test]
    fn truncation_and_reordering_are_detected() {
        let l = reference_ledger();
        let mut truncated = l.records.clone();
        truncated.pop();
        assert!(!Ledger {
            records: truncated,
            head: l.head
        }
        .verify());
        let mut swapped = l.records.clone();
        swapped.swap(1, 2);
        assert!(!Ledger {
            records: swapped,
            head: l.head
        }
        .verify());
    }

    #[test]
    fn field_boundaries_are_unambiguous() {
        // Without length prefixes, "ab" + "c" would hash like "a" + "bc".
        let mut a = Ledger::new();
        a.append(1, "ab", "c");
        let mut b = Ledger::new();
        b.append(1, "a", "bc");
        assert_ne!(a.head(), b.head());
    }
}
