//! Merkle trees over ledger records, in the shape Certificate Transparency
//! logs use (RFC 6962, restated in RFC 9162 §2.1).
//!
//! The leaves are the records' digests, in order. A tree of any size is
//! hashed by splitting at the largest power of two below its size:
//!
//! - the empty tree hashes to SHA-256 of nothing;
//! - a leaf hashes to SHA-256(`0x00` ‖ data);
//! - a node hashes to SHA-256(`0x01` ‖ left ‖ right).
//!
//! The `0x00` / `0x01` prefixes keep leaves and nodes from being confused
//! with each other. Because this is the standard construction, roots and
//! inclusion proofs can be checked with ordinary transparency-log tooling.
//!
//! A [`Frontier`] keeps just the roots of the perfect subtrees covering the
//! leaves so far, at most one per bit of the size. That is enough to append
//! a leaf and compute the root without the earlier leaves, which is what lets
//! a verifier audit a ledger's suffix from a checkpoint
//! ([`crate::checkpoint`]).

use crate::ledger::Digest;
use crate::sha256::Sha256;

/// The hash of a leaf holding `data`: SHA-256(`0x00` ‖ data).
pub fn leaf_hash(data: &[u8]) -> Digest {
    let mut h = Sha256::new();
    h.update(&[0x00]);
    h.update(data);
    Digest(h.finalize())
}

/// The hash of an interior node: SHA-256(`0x01` ‖ left ‖ right).
pub fn node_hash(left: &Digest, right: &Digest) -> Digest {
    let mut h = Sha256::new();
    h.update(&[0x01]);
    h.update(left.as_bytes());
    h.update(right.as_bytes());
    Digest(h.finalize())
}

/// The largest power of two strictly below `n` (for `n >= 2`).
fn split(n: usize) -> usize {
    debug_assert!(n >= 2);
    1 << (usize::BITS - 1 - (n - 1).leading_zeros())
}

/// The Merkle root of a tree whose leaves hold `leaves`, in order.
pub fn root(leaves: &[Digest]) -> Digest {
    match leaves.len() {
        0 => Digest(Sha256::new().finalize()),
        1 => leaf_hash(leaves[0].as_bytes()),
        n => {
            let k = split(n);
            node_hash(&root(&leaves[..k]), &root(&leaves[k..]))
        }
    }
}

/// The inclusion proof (audit path) for leaf `index`: the sibling hashes
/// from the leaf up to the root. `None` if `index` is out of range.
pub fn inclusion_proof(leaves: &[Digest], index: usize) -> Option<Vec<Digest>> {
    if index >= leaves.len() {
        return None;
    }
    let mut proof = Vec::new();
    path(index, leaves, &mut proof);
    Some(proof)
}

fn path(m: usize, leaves: &[Digest], out: &mut Vec<Digest>) {
    let n = leaves.len();
    if n <= 1 {
        return;
    }
    let k = split(n);
    if m < k {
        path(m, &leaves[..k], out);
        out.push(root(&leaves[k..]));
    } else {
        path(m - k, &leaves[k..], out);
        out.push(root(&leaves[..k]));
    }
}

/// Whether `proof` shows that leaf `index` of a tree of `size` leaves holds
/// `leaf`, in the tree with root `root` (RFC 9162 §2.1.3.2).
///
/// `size` and `root` must be trusted together, as they are in a
/// [`Checkpoint`](crate::checkpoint::Checkpoint) whose digest covers both:
/// the proof binds the leaf to the root, and `size` only says how to read
/// the path. Trees of neighbouring sizes can share a path shape, so the
/// same proof and root also "verify" for such a size.
pub fn verify_inclusion(
    leaf: &Digest,
    index: u64,
    size: u64,
    proof: &[Digest],
    root: &Digest,
) -> bool {
    if index >= size {
        return false;
    }
    let (mut f, mut s) = (index, size - 1);
    let mut r = leaf_hash(leaf.as_bytes());
    for p in proof {
        if s == 0 {
            return false;
        }
        if f & 1 == 1 || f == s {
            r = node_hash(p, &r);
            if f & 1 == 0 {
                while f & 1 == 0 && f != 0 {
                    f >>= 1;
                    s >>= 1;
                }
            }
        } else {
            r = node_hash(&r, p);
        }
        f >>= 1;
        s >>= 1;
    }
    s == 0 && r == *root
}

/// The roots of the perfect subtrees covering a tree's leaves, largest
/// (leftmost) first: one per set bit of the size. Enough to append leaves
/// and compute the root without the leaves themselves.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Frontier {
    size: u64,
    peaks: Vec<Digest>,
}

impl Frontier {
    /// The frontier of the empty tree.
    pub fn new() -> Self {
        Self::default()
    }

    /// Rebuild a frontier from its parts, or `None` if there is not exactly
    /// one peak per set bit of `size`.
    pub fn from_parts(size: u64, peaks: Vec<Digest>) -> Option<Self> {
        (peaks.len() == size.count_ones() as usize).then_some(Self { size, peaks })
    }

    /// How many leaves the tree has.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// The subtree roots, largest first.
    pub fn peaks(&self) -> &[Digest] {
        &self.peaks
    }

    /// Append a leaf holding `data`.
    pub fn push(&mut self, data: &Digest) {
        let mut node = leaf_hash(data.as_bytes());
        // Each trailing one bit of the old size is a subtree of the same
        // height as the new node: merge with it.
        let mut s = self.size;
        while s & 1 == 1 {
            let left = self.peaks.pop().expect("one peak per set bit");
            node = node_hash(&left, &node);
            s >>= 1;
        }
        self.peaks.push(node);
        self.size += 1;
    }

    /// The Merkle root, the same as [`root`] over all the leaves.
    pub fn root(&self) -> Digest {
        let mut peaks = self.peaks.iter().rev();
        match peaks.next() {
            None => Digest(Sha256::new().finalize()),
            Some(last) => peaks.fold(*last, |acc, peak| node_hash(peak, &acc)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::sha256;

    fn leaves(n: usize) -> Vec<Digest> {
        (0..n)
            .map(|i| Digest(sha256(i.to_string().as_bytes())))
            .collect()
    }

    #[test]
    fn roots_match_an_independent_implementation() {
        // From a Node implementation of RFC 6962 §2.1 written from the RFC.
        assert_eq!(
            root(&[]).to_string(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            root(&leaves(1)).to_string(),
            "13a77175e35eb1d9da91ee14df0d7772cea71289800206e2b45c882ecb06efbf"
        );
        assert_eq!(
            root(&leaves(7)).to_string(),
            "5653c4ab2514ccd6ea4f0159702d2aba901f2562aa75abcff5a19e344bee038f"
        );
        // Every root and every inclusion path for sizes 0 to 40.
        let mut all = Sha256::new();
        for n in 0..=40 {
            let l = leaves(n);
            all.update(root(&l).as_bytes());
            for m in 0..n {
                for p in inclusion_proof(&l, m).unwrap() {
                    all.update(p.as_bytes());
                }
            }
        }
        assert_eq!(
            Digest(all.finalize()).to_string(),
            "22dc99a21c395a2c9b05a530b7989b2a9f9cd3d0f6900692e507e8a5b5c0f815"
        );
    }

    #[test]
    fn the_frontier_tracks_the_root_as_leaves_arrive() {
        let l = leaves(200);
        let mut f = Frontier::new();
        assert_eq!(f.root(), root(&[]));
        for n in 1..=200 {
            f.push(&l[n - 1]);
            assert_eq!(f.size(), n as u64);
            assert_eq!(f.peaks().len(), (n as u64).count_ones() as usize);
            assert_eq!(f.root(), root(&l[..n]), "size {n}");
        }
        // Rebuilt from its parts, it carries on the same way.
        let mut copy = Frontier::from_parts(f.size(), f.peaks().to_vec()).unwrap();
        let mut more = l.clone();
        more.extend(leaves(203).split_off(200));
        copy.push(&more[200]);
        assert_eq!(copy.root(), root(&more[..201]));
        // The wrong number of peaks for the size is refused.
        assert!(Frontier::from_parts(7, vec![l[0], l[1]]).is_none());
        assert!(Frontier::from_parts(0, vec![]).is_some());
    }

    #[test]
    fn every_inclusion_proof_verifies_and_nothing_else_does() {
        for n in 1..=48usize {
            let l = leaves(n);
            let r = root(&l);
            for m in 0..n {
                let proof = inclusion_proof(&l, m).unwrap();
                let (mu, nu) = (m as u64, n as u64);
                assert!(verify_inclusion(&l[m], mu, nu, &proof, &r), "{m} of {n}");
                // Wrong leaf, index, size, root, or a changed, missing or
                // extra proof element: all fail.
                assert!(!verify_inclusion(&l[(m + 1) % n], mu, nu, &proof, &r) || n == 1);
                if n > 1 {
                    assert!(!verify_inclusion(&l[m], (mu + 1) % nu, nu, &proof, &r));
                }
                assert!(!verify_inclusion(&l[m], mu, nu, &proof, &leaf_hash(b"x")));
                // Claimed for a tree twice the size, the path is too short to
                // reach its root, however the root compares.
                assert!(!verify_inclusion(&l[m], mu, 2 * nu, &proof, &r));
                for i in 0..proof.len() {
                    let mut bad = proof.clone();
                    bad[i].0[0] ^= 1;
                    assert!(!verify_inclusion(&l[m], mu, nu, &bad, &r));
                    let mut short = proof.clone();
                    short.remove(i);
                    assert!(!verify_inclusion(&l[m], mu, nu, &short, &r));
                }
                let mut long = proof.clone();
                long.push(r);
                assert!(!verify_inclusion(&l[m], mu, nu, &long, &r));
            }
            assert!(inclusion_proof(&l, n).is_none());
            assert!(!verify_inclusion(&l[0], nu_of(n), nu_of(n), &[], &r));
        }
    }

    fn nu_of(n: usize) -> u64 {
        n as u64
    }

    #[test]
    fn leaves_and_nodes_cannot_be_confused() {
        let (a, b) = (Digest([1; 32]), Digest([2; 32]));
        let mut concat = [0u8; 64];
        concat[..32].copy_from_slice(a.as_bytes());
        concat[32..].copy_from_slice(b.as_bytes());
        assert_ne!(leaf_hash(&concat), node_hash(&a, &b));
    }
}
