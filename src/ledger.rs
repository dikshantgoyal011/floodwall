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
//! 1. the field `floodwall/ledger/record/v1` (domain separation, so a record
//!    digest is never mistaken for any other hash the crate computes);
//! 2. `prev`: the previous record's digest, 32 bytes ([`Digest::GENESIS`],
//!    all zeros, for the first record);
//! 3. `seq` as a `u64`;
//! 4. `intent_id` as a `u64`;
//! 5. the fields `agent`, `verdict` and `evidence.action`, as UTF-8;
//! 6. `evidence.reason`: the byte `0` if there is none, or the byte `1`
//!    followed by the reason as a field;
//! 7. the number of `evidence.policies` as a `u64`, then for each, its name
//!    and its label as fields.

use std::fmt;

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

const RECORD_DOMAIN: &[u8] = b"floodwall/ledger/record/v1";

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
}

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
        let mut record = Record {
            seq: self.records.len() as u64,
            intent_id,
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
    /// it, and has the digest its contents give, and the last digest is the
    /// head.
    pub fn verify(&self) -> bool {
        let mut prev = Digest::GENESIS;
        for (i, r) in self.records.iter().enumerate() {
            if r.seq != i as u64 || r.prev != prev || r.compute_digest() != r.digest {
                return false;
            }
            prev = r.digest;
        }
        prev == self.head
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
        l
    }

    #[test]
    fn digests_follow_the_documented_encoding() {
        // Computed by an independent implementation (Node's crypto) written
        // from the "Record encoding" section of this module's docs.
        let want = [
            "889448ef23eff4b84a8dc25cc93bbf2bdf5fdf7ca3bd131e141830b6514bf0cc",
            "303166f0ee828c061045efd2551c8e86b898f2cc72b87b9b46f392051af04abb",
            "66ee43cc0244deecb45662a36ed39ff7c0ef4121ca361d13064b62d22c1157ca",
            "25bd527b0e9175d8ce3d63b9c0321c93f5c42e9ef1a4dd65f5b8b81a11b0ea58",
        ];
        let l = reference_ledger();
        let got: Vec<String> = l.records().iter().map(|r| r.digest.to_string()).collect();
        assert_eq!(got, want);
        assert_eq!(l.head().to_string(), want[3]);
        assert!(l.verify());
    }

    #[test]
    fn genesis_is_all_zeros_and_digests_print_as_hex() {
        assert_eq!(Digest::GENESIS.to_string(), "0".repeat(64));
        assert_eq!(Ledger::new().head(), Digest::GENESIS);
        let l = reference_ledger();
        assert_eq!(l.records()[0].prev, Digest::GENESIS);
        let d = l.records()[0].digest;
        assert_eq!(d.as_bytes()[0], 0x88);
        assert_eq!(format!("{d:?}"), format!("Digest({d})"));
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
