//! Ed25519 signatures (RFC 8032), from scratch.
//!
//! Agents sign their intents with Ed25519 so that the ledger can prove who
//! proposed each change (see [`crate::keyring`]). Like the rest of the
//! crate this has no dependencies: field arithmetic modulo `2^255 - 19` in
//! five 51-bit limbs, the twisted Edwards curve in extended coordinates,
//! scalars modulo the group order `L`, and [`crate::sha512`] for hashing.
//!
//! Verification follows RFC 8032 §5.1.7 in its cofactorless form, the same
//! check OpenSSL makes: `S` must be below `L`, the public key must decode
//! to a curve point, and `[S]B - [k]A` must encode to exactly the `R` in the
//! signature. Results match Node's `crypto` (OpenSSL) on the RFC 8032
//! vectors, 64 random keys and messages, and malformed inputs, in the tests
//! at the bottom of this file.
//!
//! Signing avoids branching on secret data where it is easy to (scalar
//! multiplication always performs the same operations), but this code has
//! not been audited for side channels. Agents holding long-lived keys in
//! production may prefer to sign with a vetted library: the signatures are
//! standard Ed25519 and verify here all the same.

use std::fmt;
use std::sync::OnceLock;

use crate::sha512::Sha512;

// ---------------------------------------------------------------------------
// Field elements modulo p = 2^255 - 19.
// ---------------------------------------------------------------------------

const MASK51: u64 = (1 << 51) - 1;

/// An element of GF(2^255 - 19) as five 51-bit limbs, least significant
/// first. Limbs may exceed 51 bits between operations; every operation
/// keeps them below 2^54, which the multiplication relies on.
#[derive(Clone, Copy, Debug)]
struct Fe([u64; 5]);

impl Fe {
    const ZERO: Fe = Fe([0; 5]);
    const ONE: Fe = Fe([1, 0, 0, 0, 0]);

    /// Load 32 little-endian bytes, ignoring the top bit (bit 255).
    fn from_bytes(b: &[u8; 32]) -> Fe {
        let load = |i: usize| u64::from_le_bytes(b[i..i + 8].try_into().expect("8 bytes"));
        Fe([
            load(0) & MASK51,
            (load(6) >> 3) & MASK51,
            (load(12) >> 6) & MASK51,
            (load(19) >> 1) & MASK51,
            (load(24) >> 12) & MASK51,
        ])
    }

    /// Carry each limb's excess into the next, folding the top carry back
    /// in times 19 (since 2^255 = 19 mod p). Leaves limbs below 2^52.
    fn carry(mut l: [u64; 5]) -> Fe {
        let c = l[0] >> 51;
        l[0] &= MASK51;
        l[1] += c;
        let c = l[1] >> 51;
        l[1] &= MASK51;
        l[2] += c;
        let c = l[2] >> 51;
        l[2] &= MASK51;
        l[3] += c;
        let c = l[3] >> 51;
        l[3] &= MASK51;
        l[4] += c;
        let c = l[4] >> 51;
        l[4] &= MASK51;
        l[0] += c * 19;
        Fe(l)
    }

    /// The canonical encoding: the unique representative below p, as 32
    /// little-endian bytes with the top bit clear.
    fn to_bytes(self) -> [u8; 32] {
        let mut l = Fe::carry(Fe::carry(self.0).0).0;
        // Subtract p if the value is at least p: q is 1 exactly then.
        let mut q = (l[0] + 19) >> 51;
        q = (l[1] + q) >> 51;
        q = (l[2] + q) >> 51;
        q = (l[3] + q) >> 51;
        q = (l[4] + q) >> 51;
        l[0] += 19 * q;
        for i in 0..4 {
            l[i + 1] += l[i] >> 51;
            l[i] &= MASK51;
        }
        l[4] &= MASK51;

        let mut out = [0u8; 32];
        let mut acc: u128 = 0;
        let mut bits = 0;
        let mut i = 0;
        for limb in l {
            acc |= u128::from(limb) << bits;
            bits += 51;
            while bits >= 8 && i < 32 {
                out[i] = acc as u8;
                acc >>= 8;
                bits -= 8;
                i += 1;
            }
        }
        if i < 32 {
            out[i] = acc as u8;
        }
        out
    }

    fn add(self, rhs: Fe) -> Fe {
        let mut l = self.0;
        for (a, b) in l.iter_mut().zip(rhs.0) {
            *a += b;
        }
        Fe::carry(l)
    }

    fn sub(self, rhs: Fe) -> Fe {
        // Add 16p first so no limb underflows.
        const P16: [u64; 5] = [
            36_028_797_018_963_664, // 16 * (2^51 - 19)
            36_028_797_018_963_952, // 16 * (2^51 - 1)
            36_028_797_018_963_952,
            36_028_797_018_963_952,
            36_028_797_018_963_952,
        ];
        let mut l = [0u64; 5];
        for (out, ((a, p), b)) in l.iter_mut().zip(self.0.iter().zip(P16).zip(rhs.0)) {
            *out = a + p - b;
        }
        Fe::carry(l)
    }

    fn neg(self) -> Fe {
        Fe::ZERO.sub(self)
    }

    fn mul(self, rhs: Fe) -> Fe {
        let a = self.0.map(u128::from);
        let b = rhs.0.map(u128::from);
        let (b1, b2, b3, b4) = (b[1] * 19, b[2] * 19, b[3] * 19, b[4] * 19);
        let c0 = a[0] * b[0] + a[4] * b1 + a[3] * b2 + a[2] * b3 + a[1] * b4;
        let c1 = a[1] * b[0] + a[0] * b[1] + a[4] * b2 + a[3] * b3 + a[2] * b4;
        let c2 = a[2] * b[0] + a[1] * b[1] + a[0] * b[2] + a[4] * b3 + a[3] * b4;
        let c3 = a[3] * b[0] + a[2] * b[1] + a[1] * b[2] + a[0] * b[3] + a[4] * b4;
        let c4 = a[4] * b[0] + a[3] * b[1] + a[2] * b[2] + a[1] * b[3] + a[0] * b[4];

        let mask = u128::from(MASK51);
        let c1 = c1 + (c0 >> 51);
        let c2 = c2 + (c1 >> 51);
        let c3 = c3 + (c2 >> 51);
        let c4 = c4 + (c3 >> 51);
        let top = c4 >> 51;
        let l0 = (c0 & mask) + top * 19;
        Fe::carry([
            l0 as u64,
            (c1 & mask) as u64,
            (c2 & mask) as u64,
            (c3 & mask) as u64,
            (c4 & mask) as u64,
        ])
    }

    fn square(self) -> Fe {
        self.mul(self)
    }

    /// `self` raised to a power given as 32 little-endian bytes.
    fn pow(self, exp: &[u8; 32]) -> Fe {
        let mut result = Fe::ONE;
        for i in (0..256).rev() {
            result = result.square();
            if (exp[i / 8] >> (i % 8)) & 1 == 1 {
                result = result.mul(self);
            }
        }
        result
    }

    /// The multiplicative inverse, as `self^(p-2)`. Zero maps to zero.
    fn invert(self) -> Fe {
        // p - 2 = 2^255 - 21, little-endian.
        let mut exp = [0xff; 32];
        exp[0] = 0xeb;
        exp[31] = 0x7f;
        self.pow(&exp)
    }

    fn is_zero(self) -> bool {
        self.to_bytes() == [0; 32]
    }

    /// The "sign" of a field element: whether its canonical form is odd.
    fn is_negative(self) -> bool {
        self.to_bytes()[0] & 1 == 1
    }

    fn equals(self, rhs: Fe) -> bool {
        self.to_bytes() == rhs.to_bytes()
    }

    /// `a` when `choose` is 0, `b` when it is 1, without branching.
    fn select(a: Fe, b: Fe, choose: u64) -> Fe {
        let mask = 0u64.wrapping_sub(choose);
        let mut l = [0u64; 5];
        for (out, (x, y)) in l.iter_mut().zip(a.0.iter().zip(b.0)) {
            *out = x ^ (mask & (x ^ y));
        }
        Fe(l)
    }
}

/// d = -121665 / 121666, the curve constant.
fn d() -> Fe {
    Fe::from_bytes(&[
        0xa3, 0x78, 0x59, 0x13, 0xca, 0x4d, 0xeb, 0x75, 0xab, 0xd8, 0x41, 0x41, 0x4d, 0x0a, 0x70,
        0x00, 0x98, 0xe8, 0x79, 0x77, 0x79, 0x40, 0xc7, 0x8c, 0x73, 0xfe, 0x6f, 0x2b, 0xee, 0x6c,
        0x03, 0x52,
    ])
}

/// A square root of -1 modulo p: 2^((p-1)/4).
fn sqrt_m1() -> Fe {
    Fe::from_bytes(&[
        0xb0, 0xa0, 0x0e, 0x4a, 0x27, 0x1b, 0xee, 0xc4, 0x78, 0xe4, 0x2f, 0xad, 0x06, 0x18, 0x43,
        0x2f, 0xa7, 0xd7, 0xfb, 0x3d, 0x99, 0x00, 0x4d, 0x2b, 0x0b, 0xdf, 0xc1, 0x4f, 0x80, 0x24,
        0x83, 0x2b,
    ])
}

// ---------------------------------------------------------------------------
// Points on -x^2 + y^2 = 1 + d x^2 y^2, in extended coordinates.
// ---------------------------------------------------------------------------

/// A curve point (X : Y : Z : T) with x = X/Z, y = Y/Z and x*y = T/Z.
#[derive(Clone, Copy, Debug)]
struct Point {
    x: Fe,
    y: Fe,
    z: Fe,
    t: Fe,
}

impl Point {
    const IDENTITY: Point = Point {
        x: Fe::ZERO,
        y: Fe::ONE,
        z: Fe::ONE,
        t: Fe::ZERO,
    };

    /// Point addition ("add-2008-hwcd-3" for a = -1). The formula is
    /// complete on this curve, so it also doubles a point added to itself.
    fn add(self, q: Point) -> Point {
        let d2 = d().add(d());
        let a = self.y.sub(self.x).mul(q.y.sub(q.x));
        let b = self.y.add(self.x).mul(q.y.add(q.x));
        let c = self.t.mul(d2).mul(q.t);
        let dd = self.z.add(self.z).mul(q.z);
        let e = b.sub(a);
        let f = dd.sub(c);
        let g = dd.add(c);
        let h = b.add(a);
        Point {
            x: e.mul(f),
            y: g.mul(h),
            t: e.mul(h),
            z: f.mul(g),
        }
    }

    fn neg(self) -> Point {
        Point {
            x: self.x.neg(),
            y: self.y,
            z: self.z,
            t: self.t.neg(),
        }
    }

    fn select(a: Point, b: Point, choose: u64) -> Point {
        Point {
            x: Fe::select(a.x, b.x, choose),
            y: Fe::select(a.y, b.y, choose),
            z: Fe::select(a.z, b.z, choose),
            t: Fe::select(a.t, b.t, choose),
        }
    }

    /// `[k]self` for a 256-bit little-endian scalar. Every bit costs one
    /// doubling and one addition, whatever its value.
    fn mul(self, k: &[u8; 32]) -> Point {
        let mut acc = Point::IDENTITY;
        for i in (0..256).rev() {
            acc = acc.add(acc);
            let bit = u64::from((k[i / 8] >> (i % 8)) & 1);
            acc = Point::select(acc, acc.add(self), bit);
        }
        acc
    }

    /// The 32-byte encoding: y, with the sign of x in the top bit.
    fn to_bytes(self) -> [u8; 32] {
        let zinv = self.z.invert();
        let x = self.x.mul(zinv);
        let y = self.y.mul(zinv);
        let mut out = y.to_bytes();
        out[31] |= u8::from(x.is_negative()) << 7;
        out
    }

    /// Decode a point (RFC 8032 §5.1.3), rejecting a non-canonical y, a y
    /// with no matching x, and the encoding of "negative zero".
    fn from_bytes(bytes: &[u8; 32]) -> Option<Point> {
        let x_sign = bytes[31] >> 7;
        let y = Fe::from_bytes(bytes);
        let mut canonical = *bytes;
        canonical[31] &= 0x7f;
        if y.to_bytes() != canonical {
            return None; // y >= p
        }
        let y2 = y.square();
        let u = y2.sub(Fe::ONE);
        let v = d().mul(y2).add(Fe::ONE);
        // x = u v^3 (u v^7)^((p-5)/8); (p-5)/8 = 2^252 - 3.
        let v3 = v.square().mul(v);
        let v7 = v3.square().mul(v);
        let mut exp = [0xff; 32];
        exp[0] = 0xfd;
        exp[31] = 0x0f;
        let mut x = u.mul(v3).mul(u.mul(v7).pow(&exp));
        let vx2 = v.mul(x.square());
        if vx2.equals(u) {
            // x is a square root of u / v.
        } else if vx2.equals(u.neg()) {
            x = x.mul(sqrt_m1());
        } else {
            return None; // not on the curve
        }
        if x.is_zero() && x_sign == 1 {
            return None;
        }
        if u8::from(x.is_negative()) != x_sign {
            x = x.neg();
        }
        Some(Point {
            x,
            y,
            z: Fe::ONE,
            t: x.mul(y),
        })
    }
}

/// The base point B: y = 4/5, x positive.
fn base_point() -> Point {
    static B: OnceLock<[u8; 32]> = OnceLock::new();
    let bytes = B.get_or_init(|| {
        let mut b = [0x66; 32];
        b[0] = 0x58;
        b
    });
    Point::from_bytes(bytes).expect("the base point is on the curve")
}

// ---------------------------------------------------------------------------
// Scalars modulo L = 2^252 + 27742317777372353535851937790883648493.
// ---------------------------------------------------------------------------

/// The group order L, as four little-endian 64-bit limbs.
const L: [u64; 4] = [
    0x5812_631a_5cf5_d3ed,
    0x14de_f9de_a2f7_9cd6,
    0x0000_0000_0000_0000,
    0x1000_0000_0000_0000,
];

/// `a - b` on four limbs, with the borrow out.
fn sub4(a: [u64; 4], b: [u64; 4]) -> ([u64; 4], u64) {
    let mut out = [0u64; 4];
    let mut borrow = 0u64;
    for (o, (x, y)) in out.iter_mut().zip(a.iter().zip(b)) {
        let (d1, b1) = x.overflowing_sub(y);
        let (d2, b2) = d1.overflowing_sub(borrow);
        *o = d2;
        borrow = u64::from(b1 | b2);
    }
    (out, borrow)
}

/// Reduce a little-endian number of any length modulo L. Processes one
/// bit at a time, always doing the same work per bit.
fn reduce_mod_l(bytes: &[u8]) -> [u64; 4] {
    let mut r = [0u64; 4];
    for i in (0..bytes.len() * 8).rev() {
        // r = 2r + bit; r < L < 2^253, so this cannot overflow 256 bits.
        let bit = u64::from((bytes[i / 8] >> (i % 8)) & 1);
        let mut carry = bit;
        for limb in r.iter_mut() {
            let next = *limb >> 63;
            *limb = (*limb << 1) | carry;
            carry = next;
        }
        // Subtract L unless that would go negative.
        let (diff, borrow) = sub4(r, L);
        let keep = 0u64.wrapping_sub(borrow); // all ones when r < L
        for (limb, d) in r.iter_mut().zip(diff) {
            *limb = (*limb & keep) | (d & !keep);
        }
    }
    r
}

fn limbs_to_bytes(l: [u64; 4]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (chunk, limb) in out.chunks_exact_mut(8).zip(l) {
        chunk.copy_from_slice(&limb.to_le_bytes());
    }
    out
}

/// Whether a 32-byte little-endian scalar is below L.
fn is_canonical_scalar(s: &[u8; 32]) -> bool {
    let mut limbs = [0u64; 4];
    for (limb, chunk) in limbs.iter_mut().zip(s.chunks_exact(8)) {
        *limb = u64::from_le_bytes(chunk.try_into().expect("8 bytes"));
    }
    sub4(limbs, L).1 == 1
}

/// `(a * b + c) mod L` for scalars below 2^256.
fn mul_add_mod_l(a: &[u8; 32], b: &[u8; 32], c: &[u8; 32]) -> [u8; 32] {
    let limbs = |s: &[u8; 32]| {
        let mut l = [0u64; 4];
        for (limb, chunk) in l.iter_mut().zip(s.chunks_exact(8)) {
            *limb = u64::from_le_bytes(chunk.try_into().expect("8 bytes"));
        }
        l
    };
    let (a, b, c) = (limbs(a), limbs(b), limbs(c));
    // 512-bit product plus c, in eight limbs.
    let mut wide = [0u64; 8];
    for i in 0..4 {
        let mut carry: u128 = 0;
        for j in 0..4 {
            let cur = u128::from(wide[i + j]) + u128::from(a[i]) * u128::from(b[j]) + carry;
            wide[i + j] = cur as u64;
            carry = cur >> 64;
        }
        wide[i + 4] = carry as u64;
    }
    let mut carry: u128 = 0;
    for (i, limb) in wide.iter_mut().enumerate() {
        let add = if i < 4 { u128::from(c[i]) } else { 0 };
        let cur = u128::from(*limb) + add + carry;
        *limb = cur as u64;
        carry = cur >> 64;
    }
    let mut bytes = [0u8; 64];
    for (chunk, limb) in bytes.chunks_exact_mut(8).zip(wide) {
        chunk.copy_from_slice(&limb.to_le_bytes());
    }
    limbs_to_bytes(reduce_mod_l(&bytes))
}

fn hash_mod_l(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha512::new();
    for part in parts {
        h.update(part);
    }
    limbs_to_bytes(reduce_mod_l(&h.finalize()))
}

// ---------------------------------------------------------------------------
// Keys and signatures.
// ---------------------------------------------------------------------------

fn write_hex(f: &mut fmt::Formatter<'_>, bytes: &[u8]) -> fmt::Result {
    for byte in bytes {
        write!(f, "{byte:02x}")?;
    }
    Ok(())
}

/// An Ed25519 signature: 64 bytes, `R` then `S`. Displays as hex.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Signature(pub [u8; 64]);

impl Signature {
    /// The signature's bytes.
    pub fn as_bytes(&self) -> &[u8; 64] {
        &self.0
    }
}

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_hex(f, &self.0)
    }
}

impl fmt::Debug for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Signature({self})")
    }
}

/// A public key that has been checked to be a valid curve point. Displays
/// as hex.
#[derive(Clone, Copy)]
pub struct VerifyingKey {
    bytes: [u8; 32],
    point: Point,
}

/// A public key's 32 bytes do not encode a curve point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidKey;

impl fmt::Display for InvalidKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("the bytes are not a valid Ed25519 public key")
    }
}

impl std::error::Error for InvalidKey {}

impl VerifyingKey {
    /// Decode a public key, refusing bytes that are not a curve point.
    pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self, InvalidKey> {
        let point = Point::from_bytes(bytes).ok_or(InvalidKey)?;
        Ok(Self {
            bytes: *bytes,
            point,
        })
    }

    /// The key's 32 bytes.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.bytes
    }

    /// Whether `signature` is this key's signature of `message`.
    pub fn verify(&self, message: &[u8], signature: &Signature) -> bool {
        let r_bytes: &[u8; 32] = signature.0[..32].try_into().expect("32 bytes");
        let s: &[u8; 32] = signature.0[32..].try_into().expect("32 bytes");
        if !is_canonical_scalar(s) {
            return false;
        }
        let k = hash_mod_l(&[r_bytes, &self.bytes, message]);
        let r = base_point().mul(s).add(self.point.mul(&k).neg());
        r.to_bytes() == *r_bytes
    }
}

impl PartialEq for VerifyingKey {
    fn eq(&self, other: &Self) -> bool {
        self.bytes == other.bytes
    }
}

impl Eq for VerifyingKey {}

impl std::hash::Hash for VerifyingKey {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.bytes.hash(state);
    }
}

impl fmt::Display for VerifyingKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_hex(f, &self.bytes)
    }
}

impl fmt::Debug for VerifyingKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "VerifyingKey({self})")
    }
}

/// A private key, from a 32-byte seed. The seed must come from a secure
/// random source; anyone who knows it can sign as this key. Its `Debug`
/// output shows only the public key.
#[derive(Clone)]
pub struct SigningKey {
    /// The clamped secret scalar `a`.
    scalar: [u8; 32],
    /// The second half of SHA-512(seed), mixed into every nonce.
    prefix: [u8; 32],
    public: VerifyingKey,
}

impl SigningKey {
    /// Derive a key pair from a 32-byte seed (RFC 8032 §5.1.5).
    pub fn from_seed(seed: &[u8; 32]) -> Self {
        let mut h = Sha512::new();
        h.update(seed);
        let h = h.finalize();
        let mut scalar: [u8; 32] = h[..32].try_into().expect("32 bytes");
        scalar[0] &= 248;
        scalar[31] &= 127;
        scalar[31] |= 64;
        let prefix = h[32..].try_into().expect("32 bytes");
        let point = base_point().mul(&scalar);
        Self {
            scalar,
            prefix,
            public: VerifyingKey {
                bytes: point.to_bytes(),
                point,
            },
        }
    }

    /// The matching public key.
    pub fn verifying_key(&self) -> VerifyingKey {
        self.public
    }

    /// Sign `message` (RFC 8032 §5.1.6). Signing is deterministic: the same
    /// key and message always give the same signature.
    pub fn sign(&self, message: &[u8]) -> Signature {
        let r = hash_mod_l(&[&self.prefix, message]);
        let r_point = base_point().mul(&r).to_bytes();
        let k = hash_mod_l(&[&r_point, &self.public.bytes, message]);
        let s = mul_add_mod_l(&k, &self.scalar, &r);
        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&r_point);
        sig[32..].copy_from_slice(&s);
        Signature(sig)
    }
}

impl fmt::Debug for SigningKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SigningKey {{ public: {} }}", self.public)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::sha256;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn unhex<const N: usize>(s: &str) -> [u8; N] {
        let mut out = [0u8; N];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).expect("hex");
        }
        out
    }

    #[test]
    fn field_constants_are_what_they_claim() {
        // d * 121666 = -121665.
        let n = |v: u64| Fe([v, 0, 0, 0, 0]);
        assert!(d().mul(n(121_666)).equals(n(121_665).neg()));
        // sqrt(-1)^2 = -1.
        assert!(sqrt_m1().square().equals(Fe::ONE.neg()));
        // Inversion.
        let x = Fe::from_bytes(&[7; 32]);
        assert!(x.mul(x.invert()).equals(Fe::ONE));
        // p itself reduces to zero; p - 1 stays p - 1.
        let mut p = [0xff; 32];
        p[0] = 0xed;
        p[31] = 0x7f;
        assert_eq!(Fe::from_bytes(&p).to_bytes(), [0; 32]);
        let mut p_minus_1 = p;
        p_minus_1[0] = 0xec;
        assert_eq!(Fe::from_bytes(&p_minus_1).to_bytes(), p_minus_1);
        // 2^255 - 1 (all bits but the ignored top one) is 18 mod p.
        let mut all = [0xff; 32];
        all[31] = 0x7f;
        assert_eq!(Fe::from_bytes(&all).to_bytes()[0], 18);
    }

    #[test]
    fn field_arithmetic_agrees_with_itself() {
        // (a + b)(a - b) = a^2 - b^2 across a spread of values, including
        // ones near p where carries and the final reduction matter.
        let values = [
            [0u8; 32],
            [1; 32],
            [0x7f; 32],
            {
                let mut v = [0xff; 32];
                v[0] = 0xec;
                v[31] = 0x7f;
                v
            },
            sha256(b"a"),
            sha256(b"b"),
        ];
        for a in values {
            for b in values {
                let (a, b) = (Fe::from_bytes(&a), Fe::from_bytes(&b));
                let lhs = a.add(b).mul(a.sub(b));
                let rhs = a.square().sub(b.square());
                assert!(lhs.equals(rhs));
            }
        }
    }

    #[test]
    fn scalar_reduction_is_mod_l() {
        assert_eq!(
            hex(&limbs_to_bytes(L)),
            "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010"
        );
        assert_eq!(reduce_mod_l(&limbs_to_bytes(L)), [0; 4]);
        let mut l_plus_5 = limbs_to_bytes(L);
        l_plus_5[0] += 5;
        assert_eq!(reduce_mod_l(&l_plus_5), [5, 0, 0, 0]);
        assert!(!is_canonical_scalar(&limbs_to_bytes(L)));
        let mut l_minus_1 = limbs_to_bytes(L);
        l_minus_1[0] -= 1;
        assert!(is_canonical_scalar(&l_minus_1));
        // (L - 1) * (L - 1) + 0 = 1 mod L.
        assert_eq!(
            mul_add_mod_l(&l_minus_1, &l_minus_1, &[0; 32]),
            limbs_to_bytes([1, 0, 0, 0])
        );
    }

    #[test]
    fn group_law_basics() {
        let b = base_point();
        // [L]B is the identity, encoded as y = 1.
        let mut one = [0u8; 32];
        one[0] = 1;
        assert_eq!(b.mul(&limbs_to_bytes(L)).to_bytes(), one);
        // [2]B = B + B, and B - B is the identity.
        let mut two = [0u8; 32];
        two[0] = 2;
        assert_eq!(b.mul(&two).to_bytes(), b.add(b).to_bytes());
        assert_eq!(b.add(b.neg()).to_bytes(), one);
        // Encoding round-trips.
        let p = b.mul(&sha256(b"point"));
        let q = Point::from_bytes(&p.to_bytes()).expect("valid");
        assert_eq!(q.to_bytes(), p.to_bytes());
    }

    /// RFC 8032 §7.1 tests 1, 2, 3 and SHA(abc); public keys and
    /// signatures as produced by Node's crypto, which match the RFC.
    const RFC: [(&str, &str, &str, &str); 4] = [
        (
            "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
            "",
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        ),
        (
            "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
            "72",
            "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
        ),
        (
            "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
            "af82",
            "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
            "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
        ),
        (
            "833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42",
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
            "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf",
            "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704",
        ),
    ];

    fn msg_bytes(h: &str) -> Vec<u8> {
        (0..h.len() / 2)
            .map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).expect("hex"))
            .collect()
    }

    #[test]
    fn rfc_8032_vectors() {
        for (seed, msg, public, sig) in RFC {
            let key = SigningKey::from_seed(&unhex(seed));
            let msg = msg_bytes(msg);
            assert_eq!(key.verifying_key().to_string(), public);
            let signature = key.sign(&msg);
            assert_eq!(signature.to_string(), sig);
            let vk = VerifyingKey::from_bytes(&unhex(public)).expect("valid key");
            assert!(vk.verify(&msg, &signature));
        }
    }

    #[test]
    fn sixty_four_keys_and_messages_match_an_independent_implementation() {
        // Same derivation as the Node script that produced the expected
        // value: seed_i = SHA-256("floodwall-ed25519-" + i), a message of
        // (i * 37) % 300 patterned bytes, then SHA-256 over every
        // public key and signature in turn.
        let mut all = crate::sha256::Sha256::new();
        for i in 0..64u64 {
            let seed = sha256(format!("floodwall-ed25519-{i}").as_bytes());
            let n = ((i * 37) % 300) as usize;
            let msg: Vec<u8> = (0..n)
                .map(|j| ((j * 31 + i as usize) % 256) as u8)
                .collect();
            let key = SigningKey::from_seed(&seed);
            let sig = key.sign(&msg);
            assert!(key.verifying_key().verify(&msg, &sig));
            all.update(key.verifying_key().as_bytes());
            all.update(sig.as_bytes());
        }
        assert_eq!(
            hex(&all.finalize()),
            "5330908b7a41adf6a8de0690b1470778064d3fe0b29cc65bcd4f80d3ddf12671"
        );
    }

    #[test]
    fn verification_rejects_what_openssl_rejects() {
        let (seed, _, public, sig) = RFC[0];
        let vk = VerifyingKey::from_bytes(&unhex(public)).unwrap();
        let sig = Signature(unhex(sig));
        assert!(vk.verify(b"", &sig));

        // S + L encodes the same S modulo L, but is not canonical.
        let s: [u8; 32] = sig.0[32..].try_into().unwrap();
        let mut s_plus_l = [0u8; 32];
        let mut carry = 0u16;
        let l = limbs_to_bytes(L);
        for i in 0..32 {
            let v = u16::from(s[i]) + u16::from(l[i]) + carry;
            s_plus_l[i] = v as u8;
            carry = v >> 8;
        }
        let mut forged = sig;
        forged.0[32..].copy_from_slice(&s_plus_l);
        assert!(!vk.verify(b"", &forged), "non-canonical S");

        for (i, what) in [(0, "R"), (40, "S")] {
            let mut flipped = sig;
            flipped.0[i] ^= 1;
            assert!(!vk.verify(b"", &flipped), "{what} bit flipped");
        }
        assert!(!vk.verify(&[0], &sig), "message changed");
        let other = VerifyingKey::from_bytes(&unhex(RFC[1].2)).unwrap();
        assert!(!other.verify(b"", &sig), "wrong key");
        assert!(SigningKey::from_seed(&unhex(seed))
            .verifying_key()
            .verify(b"", &sig));
    }

    #[test]
    fn invalid_public_keys_are_refused() {
        // y = p is not canonical.
        let mut p = [0xff; 32];
        p[0] = 0xed;
        p[31] = 0x7f;
        assert_eq!(VerifyingKey::from_bytes(&p).err(), Some(InvalidKey));
        // y = 2 has no x on the curve.
        let mut two = [0u8; 32];
        two[0] = 2;
        assert_eq!(VerifyingKey::from_bytes(&two).err(), Some(InvalidKey));
        // y = 1 with the sign bit set is "negative zero".
        let mut neg_zero = [0u8; 32];
        neg_zero[0] = 1;
        neg_zero[31] = 0x80;
        assert_eq!(VerifyingKey::from_bytes(&neg_zero).err(), Some(InvalidKey));
        assert_eq!(
            InvalidKey.to_string(),
            "the bytes are not a valid Ed25519 public key"
        );
    }

    #[test]
    fn keys_print_without_secrets() {
        let key = SigningKey::from_seed(&[9; 32]);
        let shown = format!("{key:?}");
        assert!(shown.starts_with("SigningKey { public: "));
        assert!(!shown.contains(&hex(&key.scalar)));
        assert!(!shown.contains(&hex(&key.prefix)));
        let vk = key.verifying_key();
        assert_eq!(format!("{vk:?}"), format!("VerifyingKey({vk})"));
        let sig = key.sign(b"x");
        assert_eq!(format!("{sig:?}"), format!("Signature({sig})"));
        // Deterministic.
        assert_eq!(key.sign(b"x"), sig);
    }
}
