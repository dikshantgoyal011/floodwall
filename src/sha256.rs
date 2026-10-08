//! SHA-256 (FIPS 180-4), from scratch.
//!
//! The constants and the compression function are ported from the sibling
//! crate [`shunya`](https://github.com/protosphinx/shunya) (`src/sha256.rs`
//! at f0f17b0c, MIT, Copyright (c) 2026 protosphinx). shunya hashes a whole
//! message in one call; the ledger hashes a record field by field, so this
//! port adds a streaming [`Sha256`] around the same block function.
//!
//! No `unsafe`, no dependencies, no SIMD: correctness and readability over
//! speed. Checked against the FIPS 180-4 vectors and against an independent
//! implementation (Node's `crypto`) for every message length from 0 to 300
//! bytes, in the tests at the bottom of this file.

const H_INIT: [u32; 8] = [
    0x6a09_e667,
    0xbb67_ae85,
    0x3c6e_f372,
    0xa54f_f53a,
    0x510e_527f,
    0x9b05_688c,
    0x1f83_d9ab,
    0x5be0_cd19,
];

const K: [u32; 64] = [
    0x428a_2f98,
    0x7137_4491,
    0xb5c0_fbcf,
    0xe9b5_dba5,
    0x3956_c25b,
    0x59f1_11f1,
    0x923f_82a4,
    0xab1c_5ed5,
    0xd807_aa98,
    0x1283_5b01,
    0x2431_85be,
    0x550c_7dc3,
    0x72be_5d74,
    0x80de_b1fe,
    0x9bdc_06a7,
    0xc19b_f174,
    0xe49b_69c1,
    0xefbe_4786,
    0x0fc1_9dc6,
    0x240c_a1cc,
    0x2de9_2c6f,
    0x4a74_84aa,
    0x5cb0_a9dc,
    0x76f9_88da,
    0x983e_5152,
    0xa831_c66d,
    0xb003_27c8,
    0xbf59_7fc7,
    0xc6e0_0bf3,
    0xd5a7_9147,
    0x06ca_6351,
    0x1429_2967,
    0x27b7_0a85,
    0x2e1b_2138,
    0x4d2c_6dfc,
    0x5338_0d13,
    0x650a_7354,
    0x766a_0abb,
    0x81c2_c92e,
    0x9272_2c85,
    0xa2bf_e8a1,
    0xa81a_664b,
    0xc24b_8b70,
    0xc76c_51a3,
    0xd192_e819,
    0xd699_0624,
    0xf40e_3585,
    0x106a_a070,
    0x19a4_c116,
    0x1e37_6c08,
    0x2748_774c,
    0x34b0_bcb5,
    0x391c_0cb3,
    0x4ed8_aa4a,
    0x5b9c_ca4f,
    0x682e_6ff3,
    0x748f_82ee,
    0x78a5_636f,
    0x84c8_7814,
    0x8cc7_0208,
    0x90be_fffa,
    0xa450_6ceb,
    0xbef9_a3f7,
    0xc671_78f2,
];

/// Fold one 64-byte block into the state (FIPS 180-4 §6.2.2).
fn compress(h: &mut [u32; 8], block: &[u8; 64]) {
    let mut w = [0u32; 64];
    for (i, word) in block.chunks_exact(4).enumerate() {
        w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
    }
    for i in 16..64 {
        let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
        let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16]
            .wrapping_add(s0)
            .wrapping_add(w[i - 7])
            .wrapping_add(s1);
    }

    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = *h;
    for i in 0..64 {
        let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let ch = (e & f) ^ ((!e) & g);
        let t1 = hh
            .wrapping_add(s1)
            .wrapping_add(ch)
            .wrapping_add(K[i])
            .wrapping_add(w[i]);
        let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let t2 = s0.wrapping_add(maj);

        hh = g;
        g = f;
        f = e;
        e = d.wrapping_add(t1);
        d = c;
        c = b;
        b = a;
        a = t1.wrapping_add(t2);
    }

    for (state, word) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
        *state = state.wrapping_add(word);
    }
}

/// A streaming SHA-256: feed it bytes with [`Sha256::update`] in any
/// number of pieces, then take the digest with [`Sha256::finalize`].
///
/// ```
/// use floodwall::sha256::{sha256, Sha256};
///
/// let mut h = Sha256::new();
/// h.update(b"floodw");
/// h.update(b"all");
/// assert_eq!(h.finalize(), sha256(b"floodwall"));
/// ```
#[derive(Clone, Debug)]
pub struct Sha256 {
    state: [u32; 8],
    block: [u8; 64],
    /// Bytes buffered in `block`, always below 64.
    filled: usize,
    /// Total message length in bytes.
    len: u64,
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha256 {
    /// A hasher for an empty message.
    pub fn new() -> Self {
        Self {
            state: H_INIT,
            block: [0; 64],
            filled: 0,
            len: 0,
        }
    }

    /// Append `bytes` to the message.
    pub fn update(&mut self, mut bytes: &[u8]) {
        self.len = self.len.wrapping_add(bytes.len() as u64);
        if self.filled > 0 {
            let take = (64 - self.filled).min(bytes.len());
            self.block[self.filled..self.filled + take].copy_from_slice(&bytes[..take]);
            self.filled += take;
            bytes = &bytes[take..];
            if self.filled < 64 {
                return;
            }
            compress(&mut self.state, &self.block);
            self.filled = 0;
        }
        let mut blocks = bytes.chunks_exact(64);
        for block in &mut blocks {
            compress(&mut self.state, block.try_into().expect("exactly 64 bytes"));
        }
        let rest = blocks.remainder();
        self.block[..rest.len()].copy_from_slice(rest);
        self.filled = rest.len();
    }

    /// Pad the message (a `1` bit, zeros, then its 64-bit length) and
    /// return the 32-byte digest.
    pub fn finalize(mut self) -> [u8; 32] {
        let bit_len = self.len.wrapping_mul(8);
        self.block[self.filled] = 0x80;
        self.block[self.filled + 1..].fill(0);
        if self.filled >= 56 {
            // No room for the length: it goes in one more block.
            compress(&mut self.state, &self.block);
            self.block = [0; 64];
        }
        self.block[56..].copy_from_slice(&bit_len.to_be_bytes());
        compress(&mut self.state, &self.block);

        let mut out = [0u8; 32];
        for (chunk, word) in out.chunks_exact_mut(4).zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        out
    }
}

/// The SHA-256 digest of `input`.
pub fn sha256(input: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(input);
    h.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn fips_180_4_vectors() {
        let cases: [(&[u8], &str); 4] = [
            (
                b"",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            ),
            (
                b"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
                "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
            ),
        ];
        for (msg, want) in cases {
            assert_eq!(hex(&sha256(msg)), want, "{}", String::from_utf8_lossy(msg));
        }
    }

    #[test]
    fn a_million_as() {
        // The FIPS long-message vector, fed in uneven pieces.
        let mut h = Sha256::new();
        let chunk = [b'a'; 997];
        let mut left = 1_000_000;
        while left > 0 {
            let n = left.min(chunk.len());
            h.update(&chunk[..n]);
            left -= n;
        }
        assert_eq!(
            hex(&h.finalize()),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
        // And shunya's 1000-byte vector.
        assert_eq!(
            hex(&sha256(&[b'a'; 1000])),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
        );
    }

    #[test]
    fn every_length_from_0_to_300_matches_an_independent_implementation() {
        // Covers every padding case: lengths around 55, 56, 63, 64 and
        // multiples of 64. The expected value is SHA-256 over all 301
        // digests, computed with Node's crypto module.
        let mut all = Sha256::new();
        for n in 0..=300usize {
            let msg: Vec<u8> = (0..n).map(|i| ((i * 7 + n) % 251) as u8).collect();
            all.update(&sha256(&msg));
        }
        assert_eq!(
            hex(&all.finalize()),
            "d2606c72e64eadacbe60c817c8a74d1c658cc446db20c6735634c2665c7d7cf6"
        );
    }

    #[test]
    fn any_split_gives_the_same_digest() {
        let msg: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
        let want = "a8af099bf2e878609558dbf69d8f88f4a31040a8cf84b549a0cfa912f12ffc3f";
        assert_eq!(hex(&sha256(&msg)), want);
        for first in [0, 1, 55, 56, 63, 64, 65, 127, 128, 500, 999, 1000] {
            for second in [0, 1, 9, 64, 130] {
                let second = second.min(msg.len() - first);
                let mut h = Sha256::new();
                h.update(&msg[..first]);
                h.update(&msg[first..first + second]);
                h.update(&[]);
                h.update(&msg[first + second..]);
                assert_eq!(hex(&h.finalize()), want, "split at {first}+{second}");
            }
        }
        // Byte by byte, too.
        let mut h = Sha256::new();
        for b in &msg {
            h.update(std::slice::from_ref(b));
        }
        assert_eq!(hex(&h.finalize()), want);
    }
}
