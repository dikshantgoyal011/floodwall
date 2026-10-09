//! Checkpoints: auditing a ledger without replaying it from genesis.
//!
//! A [`Checkpoint`] is a small summary of the ledger at some size: the head
//! of the hash chain, the Merkle root over every record digest so far
//! ([`crate::merkle`]), and the frontier the root folds from. The ledger
//! cuts one every so many records ([`Ledger::with_checkpoints`]), and can
//! sign each with the plane's own Ed25519 key ([`Ledger::with_signer`]),
//! so an auditor can trust a checkpoint without trusting whoever handed it
//! over.
//!
//! From a checkpoint it already trusts, an auditor checks the rest of the
//! ledger with [`audit_suffix`]: it replays only the records after the
//! checkpoint, and confirms they extend it exactly to the latest
//! checkpoint's chain head and Merkle root. The records before the trusted
//! checkpoint are never needed. With a checkpoint's root, a single record
//! can also be shown to be in the ledger with an O(log n) inclusion proof
//! ([`Ledger::prove_inclusion`], [`crate::merkle::verify_inclusion`]).
//!
//! [`Ledger::with_checkpoints`]: crate::Ledger::with_checkpoints
//! [`Ledger::with_signer`]: crate::Ledger::with_signer
//! [`Ledger::prove_inclusion`]: crate::Ledger::prove_inclusion

use std::fmt;

use crate::ed25519::{Signature, VerifyingKey};
use crate::ledger::{Digest, Record};
use crate::merkle::Frontier;
use crate::sha256::Sha256;

/// The ledger as of `size` records.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    /// How many records it covers: the records with `seq < size`.
    pub size: u64,
    /// The digest of the last record covered ([`Digest::GENESIS`] for size 0).
    pub head: Digest,
    /// The Merkle root over the digests of every record covered.
    pub root: Digest,
    /// The roots of the perfect subtrees `root` folds from, largest first:
    /// one per set bit of `size`. Lets an auditor extend the tree with later
    /// records without the earlier ones.
    pub frontier: Vec<Digest>,
    /// The plane's signature of [`Checkpoint::digest`], if the ledger has a
    /// signer.
    pub signature: Option<Signature>,
}

const CHECKPOINT_DOMAIN: &[u8] = b"floodwall/checkpoint/v1";

impl Checkpoint {
    /// What the plane signs: SHA-256 over the field
    /// `floodwall/checkpoint/v1` (its length as a little-endian `u64`, then
    /// the bytes), then `size` as a little-endian `u64`, then `head` and
    /// `root`. The frontier is not included; it must fold to `root`.
    pub fn digest(&self) -> Digest {
        let mut h = Sha256::new();
        h.update(&(CHECKPOINT_DOMAIN.len() as u64).to_le_bytes());
        h.update(CHECKPOINT_DOMAIN);
        h.update(&self.size.to_le_bytes());
        h.update(self.head.as_bytes());
        h.update(self.root.as_bytes());
        Digest(h.finalize())
    }

    /// Whether the checkpoint is internally consistent: one frontier entry
    /// per set bit of `size`, folding to `root`, and the genesis head for an
    /// empty ledger.
    pub fn is_well_formed(&self) -> bool {
        let Some(frontier) = Frontier::from_parts(self.size, self.frontier.clone()) else {
            return false;
        };
        frontier.root() == self.root && (self.size > 0 || self.head == Digest::GENESIS)
    }

    /// Whether the checkpoint carries a valid signature by `key`.
    pub fn is_signed_by(&self, key: &VerifyingKey) -> bool {
        self.signature
            .is_some_and(|sig| key.verify(self.digest().as_bytes(), &sig))
    }
}

/// Which of the two checkpoints given to [`audit_suffix`] a problem is in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Which {
    /// The checkpoint the auditor already trusted.
    Trusted,
    /// The checkpoint being audited up to.
    Latest,
}

/// Why [`audit_suffix`] did not accept a suffix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuditError {
    /// A checkpoint is not signed by the plane's key.
    BadCheckpointSignature(Which),
    /// A checkpoint's frontier does not fold to its root, or has the wrong
    /// number of entries for its size.
    MalformedCheckpoint(Which),
    /// The latest checkpoint covers fewer records than the trusted one.
    NotAnExtension,
    /// The suffix does not have exactly the records between the two
    /// checkpoints.
    WrongSuffixLength {
        /// `latest.size - trusted.size`.
        expected: u64,
        /// How many records were given.
        got: u64,
    },
    /// The record at this position is out of place, does not link to the
    /// one before it, or does not match its own digest.
    BrokenChain {
        /// The record's position in the ledger.
        seq: u64,
    },
    /// The suffix does not end at the latest checkpoint's head.
    HeadMismatch,
    /// The suffix does not grow the trusted Merkle tree into the latest
    /// checkpoint's root.
    RootMismatch,
}

impl fmt::Display for AuditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let which = |w: &Which| match w {
            Which::Trusted => "the trusted checkpoint",
            Which::Latest => "the latest checkpoint",
        };
        match self {
            AuditError::BadCheckpointSignature(w) => {
                write!(f, "{} is not signed by the plane's key", which(w))
            }
            AuditError::MalformedCheckpoint(w) => {
                write!(f, "{}'s frontier does not fold to its root", which(w))
            }
            AuditError::NotAnExtension => {
                f.write_str("the latest checkpoint covers fewer records than the trusted one")
            }
            AuditError::WrongSuffixLength { expected, got } => write!(
                f,
                "expected the {expected} records between the checkpoints, got {got}"
            ),
            AuditError::BrokenChain { seq } => {
                write!(f, "record {seq} does not continue the chain")
            }
            AuditError::HeadMismatch => {
                f.write_str("the records do not end at the latest checkpoint's head")
            }
            AuditError::RootMismatch => f.write_str(
                "the records do not grow the trusted tree into the latest checkpoint's root",
            ),
        }
    }
}

impl std::error::Error for AuditError {}

/// Check that `suffix` is exactly what the ledger appended between
/// `trusted` and `latest`, using only those records.
///
/// With `plane_key`, both checkpoints must be signed by it. Then each
/// record must sit at the next position, link to the one before it
/// (starting from `trusted.head`) and match its own digest; the last must
/// be `latest.head`; and appending their digests to `trusted`'s frontier
/// must give `latest.root`. Records before `trusted` are never needed.
pub fn audit_suffix(
    trusted: &Checkpoint,
    latest: &Checkpoint,
    suffix: &[Record],
    plane_key: Option<&VerifyingKey>,
) -> Result<(), AuditError> {
    if let Some(key) = plane_key {
        for (cp, which) in [(trusted, Which::Trusted), (latest, Which::Latest)] {
            if !cp.is_signed_by(key) {
                return Err(AuditError::BadCheckpointSignature(which));
            }
        }
    }
    for (cp, which) in [(trusted, Which::Trusted), (latest, Which::Latest)] {
        if !cp.is_well_formed() {
            return Err(AuditError::MalformedCheckpoint(which));
        }
    }
    if latest.size < trusted.size {
        return Err(AuditError::NotAnExtension);
    }
    let expected = latest.size - trusted.size;
    if suffix.len() as u64 != expected {
        return Err(AuditError::WrongSuffixLength {
            expected,
            got: suffix.len() as u64,
        });
    }

    let mut frontier = Frontier::from_parts(trusted.size, trusted.frontier.clone())
        .expect("checked well-formed above");
    let mut prev = trusted.head;
    for (i, record) in suffix.iter().enumerate() {
        let seq = trusted.size + i as u64;
        if record.seq != seq || record.prev != prev || record.compute_digest() != record.digest {
            return Err(AuditError::BrokenChain { seq });
        }
        frontier.push(&record.digest);
        prev = record.digest;
    }
    if prev != latest.head {
        return Err(AuditError::HeadMismatch);
    }
    if frontier.root() != latest.root {
        return Err(AuditError::RootMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ed25519::SigningKey;
    use crate::ledger::{Evidence, Ledger};
    use crate::merkle::{root, verify_inclusion};

    fn plane_key() -> SigningKey {
        SigningKey::from_seed(&[42; 32])
    }

    /// 23 records, a signed checkpoint at size 0 (cut by hand), then one
    /// every 4 records (4, 8, ..., 20), and one cut by hand at 23.
    fn ledger() -> Ledger {
        let mut l = Ledger::new().with_checkpoints(4).with_signer(plane_key());
        l.checkpoint();
        for i in 0..23u64 {
            l.append_with(
                i,
                "bot",
                if i % 3 == 0 { "admit" } else { "defer" },
                Evidence {
                    action: format!("scale web to {i}"),
                    ..Evidence::default()
                },
            );
        }
        l.checkpoint();
        l
    }

    fn audit(l: &Ledger, from: usize, to: usize) -> Result<(), AuditError> {
        let (t, c) = (&l.checkpoints()[from], &l.checkpoints()[to]);
        let suffix = &l.records()[t.size as usize..c.size as usize];
        audit_suffix(t, c, suffix, Some(&plane_key().verifying_key()))
    }

    #[test]
    fn checkpoints_are_cut_on_schedule_and_commit_to_the_records() {
        let l = ledger();
        let sizes: Vec<u64> = l.checkpoints().iter().map(|c| c.size).collect();
        assert_eq!(sizes, [0, 4, 8, 12, 16, 20, 23]);
        let digests: Vec<Digest> = l.records().iter().map(|r| r.digest).collect();
        for c in l.checkpoints() {
            assert!(c.is_well_formed());
            assert!(c.is_signed_by(&plane_key().verifying_key()));
            assert_eq!(c.root, root(&digests[..c.size as usize]));
            let head = match c.size {
                0 => Digest::GENESIS,
                n => digests[n as usize - 1],
            };
            assert_eq!(c.head, head);
        }
        assert!(l.verify());
        assert_eq!(
            l.verify_checkpoint_signatures(&plane_key().verifying_key()),
            Ok(7)
        );
        assert_eq!(l.signer(), Some(plane_key().verifying_key()));
    }

    #[test]
    fn any_suffix_audits_from_any_earlier_checkpoint() {
        let l = ledger();
        let n = l.checkpoints().len();
        for from in 0..n {
            for to in from..n {
                assert_eq!(audit(&l, from, to), Ok(()), "{from} -> {to}");
            }
        }
        // records_after hands over exactly the suffix.
        let first = &l.checkpoints()[1];
        assert_eq!(l.records_after(first).unwrap().len(), 23 - 4);
        let beyond = Checkpoint {
            size: 99,
            ..first.clone()
        };
        assert!(l.records_after(&beyond).is_none());
        // Sizes that do not fit a 32-bit usize must not wrap round to a
        // small offset there (review on PR #14).
        for size in [1u64 << 32, (1u64 << 32) + 5, u64::MAX] {
            let huge = Checkpoint {
                size,
                ..first.clone()
            };
            assert!(l.records_after(&huge).is_none(), "size {size}");
        }
    }

    #[test]
    fn a_wrong_suffix_is_refused() {
        let l = ledger();
        let key = plane_key().verifying_key();
        let (t, c) = (&l.checkpoints()[2], &l.checkpoints()[5]); // 8 -> 20
        let suffix = l.records()[8..20].to_vec();
        let check = |s: &[Record]| audit_suffix(t, c, s, Some(&key));
        assert_eq!(check(&suffix), Ok(()));

        assert_eq!(
            check(&suffix[1..]),
            Err(AuditError::WrongSuffixLength {
                expected: 12,
                got: 11
            })
        );
        let mut extra = suffix.clone();
        extra.push(l.records()[20].clone());
        assert!(matches!(
            check(&extra),
            Err(AuditError::WrongSuffixLength { .. })
        ));

        let mut edited = suffix.clone();
        edited[3].verdict = "admit".into();
        assert_eq!(check(&edited), Err(AuditError::BrokenChain { seq: 11 }));

        let mut swapped = suffix.clone();
        swapped.swap(4, 5);
        assert_eq!(check(&swapped), Err(AuditError::BrokenChain { seq: 12 }));

        // A suffix from the wrong place: right length, wrong start.
        let shifted = l.records()[9..21].to_vec();
        assert_eq!(check(&shifted), Err(AuditError::BrokenChain { seq: 8 }));

        // A record from a fork: the right position and a valid digest of
        // its own, but it does not follow the record before it. The audit
        // names the record, rather than only noticing the root is off.
        let mut forked = suffix.clone();
        forked[5].prev = Digest([7; 32]);
        forked[5].digest = forked[5].compute_digest();
        assert_eq!(check(&forked), Err(AuditError::BrokenChain { seq: 13 }));
    }

    #[test]
    fn a_rewritten_history_only_passes_without_the_plane_key() {
        // Someone holding the ledger rewrites a record, re-chains everything
        // after it, and makes their own checkpoint to match.
        let l = ledger();
        let t = l.checkpoints()[2].clone(); // size 8
        let mut forged = l.records()[8..23].to_vec();
        forged[0].verdict = "admit".into();
        let mut prev = t.head;
        let mut frontier = Frontier::from_parts(t.size, t.frontier.clone()).unwrap();
        for r in &mut forged {
            r.prev = prev;
            r.digest = r.compute_digest();
            prev = r.digest;
            frontier.push(&r.digest);
        }
        let mut fake = Checkpoint {
            size: 23,
            head: prev,
            root: frontier.root(),
            frontier: frontier.peaks().to_vec(),
            signature: None,
        };
        // Without a key to check against, the forgery is self-consistent.
        assert_eq!(audit_suffix(&t, &fake, &forged, None), Ok(()));
        // With the plane's key it is caught: unsigned, or signed by
        // another key.
        let key = plane_key().verifying_key();
        assert_eq!(
            audit_suffix(&t, &fake, &forged, Some(&key)),
            Err(AuditError::BadCheckpointSignature(Which::Latest))
        );
        let impostor = SigningKey::from_seed(&[43; 32]);
        fake.signature = Some(impostor.sign(fake.digest().as_bytes()));
        assert_eq!(
            audit_suffix(&t, &fake, &forged, Some(&key)),
            Err(AuditError::BadCheckpointSignature(Which::Latest))
        );
        // And against the real latest checkpoint, the forged records fail.
        let real = &l.checkpoints()[6];
        assert_eq!(
            audit_suffix(&t, real, &forged, Some(&key)),
            Err(AuditError::HeadMismatch)
        );
    }

    #[test]
    fn bad_checkpoints_are_refused() {
        let l = ledger();
        let key = plane_key().verifying_key();
        let (t, c) = (l.checkpoints()[1].clone(), l.checkpoints()[4].clone()); // 4 -> 16
        let suffix = l.records()[4..16].to_vec();

        // Later before earlier.
        assert_eq!(
            audit_suffix(&c, &t, &[], None),
            Err(AuditError::NotAnExtension)
        );
        // The trusted checkpoint must be signed too.
        let mut unsigned = t.clone();
        unsigned.signature = None;
        assert_eq!(
            audit_suffix(&unsigned, &c, &suffix, Some(&key)),
            Err(AuditError::BadCheckpointSignature(Which::Trusted))
        );
        // A frontier that does not fold to the root, or has the wrong
        // number of entries for the size.
        let mut bad = t.clone();
        bad.frontier[0].0[0] ^= 1;
        assert_eq!(
            audit_suffix(&bad, &c, &suffix, None),
            Err(AuditError::MalformedCheckpoint(Which::Trusted))
        );
        let mut short = c.clone();
        short.frontier.pop();
        assert_eq!(
            audit_suffix(&t, &short, &suffix, None),
            Err(AuditError::MalformedCheckpoint(Which::Latest))
        );
        // A well-formed latest checkpoint for a different tree.
        let mut other = c.clone();
        other.frontier[0] = Digest([9; 32]);
        other.root = Frontier::from_parts(other.size, other.frontier.clone())
            .unwrap()
            .root();
        assert_eq!(
            audit_suffix(&t, &other, &suffix, None),
            Err(AuditError::RootMismatch)
        );
        let mut wrong_head = c.clone();
        wrong_head.head = Digest([1; 32]);
        assert_eq!(
            audit_suffix(&t, &wrong_head, &suffix, None),
            Err(AuditError::HeadMismatch)
        );
        // An empty ledger's checkpoint must have the genesis head.
        let mut empty = l.checkpoints()[0].clone();
        assert!(empty.is_well_formed());
        empty.head = Digest([1; 32]);
        assert!(!empty.is_well_formed());
    }

    #[test]
    fn verify_catches_tampered_checkpoints() {
        assert!(ledger().verify());
        let tamper = |edit: fn(&mut Vec<Checkpoint>)| {
            let mut l = ledger();
            edit(l.checkpoints_mut());
            l.verify()
        };
        assert!(!tamper(|cs| cs[3].root.0[0] ^= 1));
        assert!(!tamper(|cs| cs[3].head.0[0] ^= 1));
        assert!(!tamper(|cs| cs[3].frontier[0].0[0] ^= 1));
        assert!(!tamper(|cs| cs.swap(2, 3)));
        assert!(!tamper(|cs| {
            let mut late = cs[6].clone();
            late.size = 24;
            cs.push(late);
        }));
        assert!(!tamper(|cs| {
            let dup = cs[2].clone();
            cs.insert(3, dup);
        }));
    }

    #[test]
    fn checkpoint_signatures_are_checked_against_the_plane_key() {
        // A signer added late: earlier checkpoints are unsigned.
        let mut l = Ledger::new().with_checkpoints(2);
        for i in 0..4 {
            l.append(i, "bot", "admit");
        }
        let mut l = l.with_signer(plane_key());
        for i in 4..6 {
            l.append(i, "bot", "admit");
        }
        let key = plane_key().verifying_key();
        assert_eq!(l.verify_checkpoint_signatures(&key), Err(0));
        assert!(l.checkpoints()[2].is_signed_by(&key));
        let other = SigningKey::from_seed(&[1; 32]).verifying_key();
        assert!(!l.checkpoints()[2].is_signed_by(&other));
        assert_eq!(Ledger::new().verify_checkpoint_signatures(&key), Ok(0));
    }

    #[test]
    fn checkpoint_is_idempotent_at_one_size() {
        let mut l = Ledger::new();
        l.append(1, "bot", "admit");
        let a = l.checkpoint();
        let b = l.checkpoint();
        assert_eq!(a, b);
        assert_eq!(l.checkpoints().len(), 1);
        assert_eq!(a.signature, None);
    }

    #[test]
    #[should_panic(expected = "checkpoint interval must be at least 1")]
    fn a_zero_interval_is_refused() {
        let _ = Ledger::new().with_checkpoints(0);
    }

    #[test]
    fn any_record_can_be_proven_in_a_checkpoint() {
        let l = ledger();
        let c = &l.checkpoints()[5]; // size 20
        for seq in 0..20u64 {
            let proof = l.prove_inclusion(seq, c.size).unwrap();
            let digest = l.records()[seq as usize].digest;
            assert!(verify_inclusion(&digest, seq, c.size, &proof, &c.root));
            // Proofs stay logarithmic in the ledger's size.
            assert!(proof.len() <= 5);
        }
        // Not for a record past the checkpoint, nor a size past the ledger.
        assert!(l.prove_inclusion(20, 20).is_none());
        assert!(l.prove_inclusion(0, 24).is_none());
        let proof = l.prove_inclusion(3, 20).unwrap();
        let other = l.records()[4].digest;
        assert!(!verify_inclusion(&other, 3, 20, &proof, &c.root));
    }

    #[test]
    fn checkpoint_digests_cover_size_head_and_root() {
        let c = ledger().checkpoints()[3].clone();
        let d = c.digest();
        let edits: [fn(&mut Checkpoint); 3] =
            [|c| c.size += 1, |c| c.head.0[0] ^= 1, |c| c.root.0[0] ^= 1];
        for edit in edits {
            let mut changed = c.clone();
            edit(&mut changed);
            assert_ne!(changed.digest(), d);
        }
    }

    #[test]
    fn errors_read_plainly() {
        let cases = [
            (
                AuditError::BadCheckpointSignature(Which::Latest),
                "the latest checkpoint is not signed by the plane's key",
            ),
            (
                AuditError::MalformedCheckpoint(Which::Trusted),
                "the trusted checkpoint's frontier does not fold to its root",
            ),
            (
                AuditError::NotAnExtension,
                "the latest checkpoint covers fewer records than the trusted one",
            ),
            (
                AuditError::WrongSuffixLength {
                    expected: 3,
                    got: 2,
                },
                "expected the 3 records between the checkpoints, got 2",
            ),
            (
                AuditError::BrokenChain { seq: 7 },
                "record 7 does not continue the chain",
            ),
            (
                AuditError::HeadMismatch,
                "the records do not end at the latest checkpoint's head",
            ),
            (
                AuditError::RootMismatch,
                "the records do not grow the trusted tree into the latest checkpoint's root",
            ),
        ];
        for (e, text) in cases {
            assert_eq!(e.to_string(), text);
        }
    }
}
