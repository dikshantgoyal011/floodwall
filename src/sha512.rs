//! SHA-512 (FIPS 180-4), from scratch.
//!
//! Ed25519 ([`crate::ed25519`]) hashes keys and messages with SHA-512. The
//! structure mirrors [`crate::sha256`]: a streaming [`Sha512`] around a block
//! function, with 64-bit words, 80 rounds, 128-byte blocks and a 128-bit
//! length. The constants are the fractional parts of the square and cube
//! roots of the first primes, as FIPS 180-4 defines them.
//!
//! Checked against the FIPS 180-4 vectors and against an independent
//! implementation (Node's `crypto`) for every message length from 0 to 300
//! bytes, in the tests at the bottom of this file.

const H_INIT: [u64; 8] = [
    0x6a09_e667_f3bc_c908,
    0xbb67_ae85_84ca_a73b,
    0x3c6e_f372_fe94_f82b,
    0xa54f_f53a_5f1d_36f1,
    0x510e_527f_ade6_82d1,
    0x9b05_688c_2b3e_6c1f,
    0x1f83_d9ab_fb41_bd6b,
    0x5be0_cd19_137e_2179,
];

const K: [u64; 80] = [
    0x428a_2f98_d728_ae22,
    0x7137_4491_23ef_65cd,
    0xb5c0_fbcf_ec4d_3b2f,
    0xe9b5_dba5_8189_dbbc,
    0x3956_c25b_f348_b538,
    0x59f1_11f1_b605_d019,
    0x923f_82a4_af19_4f9b,
    0xab1c_5ed5_da6d_8118,
    0xd807_aa98_a303_0242,
    0x1283_5b01_4570_6fbe,
    0x2431_85be_4ee4_b28c,
    0x550c_7dc3_d5ff_b4e2,
    0x72be_5d74_f27b_896f,
    0x80de_b1fe_3b16_96b1,
    0x9bdc_06a7_25c7_1235,
    0xc19b_f174_cf69_2694,
    0xe49b_69c1_9ef1_4ad2,
    0xefbe_4786_384f_25e3,
    0x0fc1_9dc6_8b8c_d5b5,
    0x240c_a1cc_77ac_9c65,
    0x2de9_2c6f_592b_0275,
    0x4a74_84aa_6ea6_e483,
    0x5cb0_a9dc_bd41_fbd4,
    0x76f9_88da_8311_53b5,
    0x983e_5152_ee66_dfab,
    0xa831_c66d_2db4_3210,
    0xb003_27c8_98fb_213f,
    0xbf59_7fc7_beef_0ee4,
    0xc6e0_0bf3_3da8_8fc2,
    0xd5a7_9147_930a_a725,
    0x06ca_6351_e003_826f,
    0x1429_2967_0a0e_6e70,
    0x27b7_0a85_46d2_2ffc,
    0x2e1b_2138_5c26_c926,
    0x4d2c_6dfc_5ac4_2aed,
    0x5338_0d13_9d95_b3df,
    0x650a_7354_8baf_63de,
    0x766a_0abb_3c77_b2a8,
    0x81c2_c92e_47ed_aee6,
    0x9272_2c85_1482_353b,
    0xa2bf_e8a1_4cf1_0364,
    0xa81a_664b_bc42_3001,
    0xc24b_8b70_d0f8_9791,
    0xc76c_51a3_0654_be30,
    0xd192_e819_d6ef_5218,
    0xd699_0624_5565_a910,
    0xf40e_3585_5771_202a,
    0x106a_a070_32bb_d1b8,
    0x19a4_c116_b8d2_d0c8,
    0x1e37_6c08_5141_ab53,
    0x2748_774c_df8e_eb99,
    0x34b0_bcb5_e19b_48a8,
    0x391c_0cb3_c5c9_5a63,
    0x4ed8_aa4a_e341_8acb,
    0x5b9c_ca4f_7763_e373,
    0x682e_6ff3_d6b2_b8a3,
    0x748f_82ee_5def_b2fc,
    0x78a5_636f_4317_2f60,
    0x84c8_7814_a1f0_ab72,
    0x8cc7_0208_1a64_39ec,
    0x90be_fffa_2363_1e28,
    0xa450_6ceb_de82_bde9,
    0xbef9_a3f7_b2c6_7915,
    0xc671_78f2_e372_532b,
    0xca27_3ece_ea26_619c,
    0xd186_b8c7_21c0_c207,
    0xeada_7dd6_cde0_eb1e,
    0xf57d_4f7f_ee6e_d178,
    0x06f0_67aa_7217_6fba,
    0x0a63_7dc5_a2c8_98a6,
    0x113f_9804_bef9_0dae,
    0x1b71_0b35_131c_471b,
    0x28db_77f5_2304_7d84,
    0x32ca_ab7b_40c7_2493,
    0x3c9e_be0a_15c9_bebc,
    0x431d_67c4_9c10_0d4c,
    0x4cc5_d4be_cb3e_42b6,
    0x597f_299c_fc65_7e2a,
    0x5fcb_6fab_3ad6_faec,
    0x6c44_198c_4a47_5817,
];

/// Fold one 128-byte block into the state (FIPS 180-4 §6.4.2).
fn compress(h: &mut [u64; 8], block: &[u8; 128]) {
    let mut w = [0u64; 80];
    for (i, word) in block.chunks_exact(8).enumerate() {
        w[i] = u64::from_be_bytes(word.try_into().expect("8 bytes"));
    }
    for i in 16..80 {
        let s0 = w[i - 15].rotate_right(1) ^ w[i - 15].rotate_right(8) ^ (w[i - 15] >> 7);
        let s1 = w[i - 2].rotate_right(19) ^ w[i - 2].rotate_right(61) ^ (w[i - 2] >> 6);
        w[i] = w[i - 16]
            .wrapping_add(s0)
            .wrapping_add(w[i - 7])
            .wrapping_add(s1);
    }

    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = *h;
    for i in 0..80 {
        let s1 = e.rotate_right(14) ^ e.rotate_right(18) ^ e.rotate_right(41);
        let ch = (e & f) ^ ((!e) & g);
        let t1 = hh
            .wrapping_add(s1)
            .wrapping_add(ch)
            .wrapping_add(K[i])
            .wrapping_add(w[i]);
        let s0 = a.rotate_right(28) ^ a.rotate_right(34) ^ a.rotate_right(39);
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

/// A streaming SHA-512: feed it bytes with [`Sha512::update`] in any
/// number of pieces, then take the digest with [`Sha512::finalize`].
#[derive(Clone, Debug)]
pub struct Sha512 {
    state: [u64; 8],
    block: [u8; 128],
    /// Bytes buffered in `block`, always below 128.
    filled: usize,
    /// Total message length in bytes.
    len: u128,
}

impl Default for Sha512 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha512 {
    /// A hasher for an empty message.
    pub fn new() -> Self {
        Self {
            state: H_INIT,
            block: [0; 128],
            filled: 0,
            len: 0,
        }
    }

    /// Append `bytes` to the message.
    pub fn update(&mut self, mut bytes: &[u8]) {
        self.len = self.len.wrapping_add(bytes.len() as u128);
        if self.filled > 0 {
            let take = (128 - self.filled).min(bytes.len());
            self.block[self.filled..self.filled + take].copy_from_slice(&bytes[..take]);
            self.filled += take;
            bytes = &bytes[take..];
            if self.filled < 128 {
                return;
            }
            compress(&mut self.state, &self.block);
            self.filled = 0;
        }
        let mut blocks = bytes.chunks_exact(128);
        for block in &mut blocks {
            compress(
                &mut self.state,
                block.try_into().expect("exactly 128 bytes"),
            );
        }
        let rest = blocks.remainder();
        self.block[..rest.len()].copy_from_slice(rest);
        self.filled = rest.len();
    }

    /// Pad the message (a `1` bit, zeros, then its 128-bit length) and
    /// return the 64-byte digest.
    pub fn finalize(mut self) -> [u8; 64] {
        let bit_len = self.len.wrapping_mul(8);
        self.block[self.filled] = 0x80;
        self.block[self.filled + 1..].fill(0);
        if self.filled >= 112 {
            // No room for the length: it goes in one more block.
            compress(&mut self.state, &self.block);
            self.block = [0; 128];
        }
        self.block[112..].copy_from_slice(&bit_len.to_be_bytes());
        compress(&mut self.state, &self.block);

        let mut out = [0u8; 64];
        for (chunk, word) in out.chunks_exact_mut(8).zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        out
    }
}

/// The SHA-512 digest of `input`.
pub fn sha512(input: &[u8]) -> [u8; 64] {
    let mut h = Sha512::new();
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
        let cases: [(&[u8], &str); 3] = [
            (
                b"",
                "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
            ),
            (
                b"abc",
                "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
            ),
            (
                b"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
                "8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909",
            ),
        ];
        for (msg, want) in cases {
            assert_eq!(hex(&sha512(msg)), want, "{}", String::from_utf8_lossy(msg));
        }
    }

    #[test]
    fn a_million_as() {
        let mut h = Sha512::new();
        let chunk = [b'a'; 997];
        let mut left = 1_000_000;
        while left > 0 {
            let n = left.min(chunk.len());
            h.update(&chunk[..n]);
            left -= n;
        }
        assert_eq!(
            hex(&h.finalize()),
            "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b"
        );
    }

    #[test]
    fn every_length_from_0_to_300_matches_an_independent_implementation() {
        // Covers every padding case: lengths around 111, 112, 127, 128 and
        // multiples of 128. The expected value is SHA-512 over all 301
        // digests, computed with Node's crypto module.
        let mut all = Sha512::new();
        for n in 0..=300usize {
            let msg: Vec<u8> = (0..n).map(|i| ((i * 7 + n) % 251) as u8).collect();
            all.update(&sha512(&msg));
        }
        assert_eq!(
            hex(&all.finalize()),
            "2aa0968ab16975944406ccb412600eaa63db990b5c27cd067aaec2d4ad3a51d794360c474ae14ce1c0143e5dede30aa44245426319a66e4ac3d7d23af1b25636"
        );
    }

    #[test]
    fn any_split_gives_the_same_digest() {
        let msg: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
        let want = "6cd2eda9bf9c0597129029b0054b81e433f6b8b7b499a75eb705efd74bac194149835b1d1a14c48be696e4d588456d512a22eae7aa1b57be2b56eae7d35e08cb";
        assert_eq!(hex(&sha512(&msg)), want);
        for first in [0, 1, 111, 112, 127, 128, 129, 255, 256, 500, 999, 1000] {
            for second in [0, 1, 9, 128, 260] {
                let second = second.min(msg.len() - first);
                let mut h = Sha512::new();
                h.update(&msg[..first]);
                h.update(&msg[first..first + second]);
                h.update(&[]);
                h.update(&msg[first + second..]);
                assert_eq!(hex(&h.finalize()), want, "split at {first}+{second}");
            }
        }
    }
}
