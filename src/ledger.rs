//! Tamper-evident provenance.
//!
//! Every decision the floodwall makes is appended to a hash chain: each
//! record's digest folds in the previous record's digest, so any retroactive
//! edit to history breaks the chain from that point forward. [`Ledger::verify`]
//! recomputes the whole chain and confirms nothing has been altered.
//!
//! v0.1 uses a hand-rolled 64-bit FNV-1a as the digest - enough to detect
//! accidental corruption and to demonstrate the chain. Swap in a cryptographic
//! hash (see the sibling crate `shunya` for a from-scratch SHA-256) before
//! trusting it against a motivated adversary.

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn fnv1a(seed: u64, bytes: &[u8]) -> u64 {
    let mut h = seed;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(FNV_PRIME);
    }
    h
}

/// Fold one variable-length field into the hash, prefixed by its length so
/// field boundaries are unambiguous (`"ab" + "c"` never hashes like
/// `"a" + "bc"`).
fn fold_field(h: u64, bytes: &[u8]) -> u64 {
    fnv1a(fnv1a(h, &(bytes.len() as u64).to_le_bytes()), bytes)
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
    pub prev: u64,
    /// Digest of this record.
    pub digest: u64,
}

/// An append-only, hash-chained log of decisions.
pub struct Ledger {
    records: Vec<Record>,
    head: u64,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::new()
    }
}

impl Ledger {
    /// A fresh ledger whose head is the genesis seed.
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
            head: FNV_OFFSET,
        }
    }

    /// Digest of every field of `r` except `digest` itself.
    fn digest(r: &Record) -> u64 {
        let mut h = fnv1a(FNV_OFFSET, &r.prev.to_le_bytes());
        h = fnv1a(h, &r.seq.to_le_bytes());
        h = fnv1a(h, &r.intent_id.to_le_bytes());
        h = fold_field(h, r.agent.as_bytes());
        h = fold_field(h, r.verdict.as_bytes());
        h = fold_field(h, r.evidence.action.as_bytes());
        h = match &r.evidence.reason {
            None => fnv1a(h, &[0]),
            Some(reason) => fold_field(fnv1a(h, &[1]), reason.as_bytes()),
        };
        h = fnv1a(h, &(r.evidence.policies.len() as u64).to_le_bytes());
        for (name, label) in &r.evidence.policies {
            h = fold_field(h, name.as_bytes());
            h = fold_field(h, label.as_bytes());
        }
        h
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
            digest: 0,
        };
        record.digest = Self::digest(&record);
        self.head = record.digest;
        self.records.push(record);
        self.records.last().expect("a record was just pushed")
    }

    /// Recompute the chain from genesis and confirm nothing has been altered.
    pub fn verify(&self) -> bool {
        let mut prev = FNV_OFFSET;
        for r in &self.records {
            if r.prev != prev {
                return false;
            }
            let digest = Self::digest(r);
            if digest != r.digest {
                return false;
            }
            prev = digest;
        }
        true
    }

    /// The current head digest - a fingerprint of the entire history.
    pub fn head(&self) -> u64 {
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
        assert_eq!(l.head(), FNV_OFFSET);
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
