#!/usr/bin/env node
// Verify a floodwall ledger export with nothing but Node's standard library.
//
//   node tools/verify-ledger.mjs LEDGER.jsonl [KEYS.json]
//
// This is an independent implementation of the formats documented in the
// crate (src/export.rs, and the encodings in src/ledger.rs, src/intent.rs,
// src/checkpoint.rs and src/merkle.rs). It shares no code with the Rust
// implementation: if it agrees, the export really is enough to audit the
// ledger with your own tooling.
//
// It checks, line by line:
//   - every line has exactly the documented fields, with the documented
//     types, and is written exactly as floodwall writes it (so no two JSON
//     parsers can read it differently: no duplicate keys, no other number
//     or string spellings);
//   - every record is at the next position, links to the one before it,
//     has the digest its fields give, and shows the intent it holds: the
//     same intent id, agent and action;
//   - every checkpoint matches the records so far: chain head, RFC 6962
//     Merkle root, and frontier; and checkpoint sizes strictly increase;
//   - with KEYS.json ({"plane": hex|null, "agents": {name: hex},
//     "retired": {name: [hex, ...]}}, "retired" optional): every checkpoint
//     is signed by the plane's key, and every record holds an intent signed
//     by its agent's current or a retired key.
// A suffix export (header "from" > 0) starts from the checkpoint on its
// second line, which the auditor trusts; it must be there, and signed when
// a plane key is given.
//
// Exits 0 and prints a summary if everything checks out; otherwise prints
// the first problem, with its line number, and exits 1. A keys file that
// is given but is not a valid keys object is a failure, never a fallback
// to checking hashes only.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GENESIS = "0".repeat(64);
const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
const hex = (b) => Buffer.from(b).toString("hex");
const isHex = (h, bytes) => typeof h === "string" && h.length === bytes * 2 && /^[0-9a-f]*$/.test(h);
const unhex = (h, bytes, what) => {
  if (!isHex(h, bytes)) throw new Error(`${what} is not ${bytes} bytes of lowercase hex`);
  return Buffer.from(h, "hex");
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const field = (s) => {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([u64(bytes.length), bytes]);
};
const optional = (bytes) => (bytes === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), bytes]));

// The schema (src/export.rs). Each check throws an Error naming the
// offending field.
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function fields(obj, names, what, ordered = true) {
  if (!isObject(obj)) throw new Error(`${what} is not a JSON object`);
  const got = Object.keys(obj);
  for (const k of got) if (!names.includes(k)) throw new Error(`${what} has an unknown field ${JSON.stringify(k)}`);
  for (const k of names) if (!got.includes(k)) throw new Error(`${what} has no ${JSON.stringify(k)}`);
  if (ordered && got.some((k, n) => k !== names[n])) throw new Error(`${what} does not have its fields in the documented order`);
}
function string(s, what) {
  // A lone surrogate cannot be UTF-8, so it would hash as U+FFFD.
  if (typeof s !== "string" || /\p{Surrogate}/u.test(s)) throw new Error(`${what} is not a string`);
}
function count(n, what) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${what} is not a non-negative integer`);
}
function decimalU64(s, what) {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s) || BigInt(s) >= 1n << 64n) {
    throw new Error(`${what} is not a u64 written as a decimal string`);
  }
}
const nullOr = (check) => (v, what) => v === null || check(v, what);
const hexOf = (bytes) => (h, what) => unhex(h, bytes, what);

const PRIORITIES = ["bulk", "normal", "urgent", "pager"];
const BLAST_RADII = ["cell", "service", "region", "global"];
const ACTIONS = { apply: ["kind", "resource", "manifest"], scale: ["kind", "resource", "replicas"], destroy: ["kind", "resource"] };

function checkIntent(i, what) {
  fields(i, ["id", "agent", "action", "priority", "blast_radius", "signature"], what);
  decimalU64(i.id, `${what}.id`);
  string(i.agent, `${what}.agent`);
  const a = i.action;
  if (!isObject(a) || !Object.hasOwn(ACTIONS, a.kind)) throw new Error(`${what}.action is not an apply, scale or destroy`);
  fields(a, ACTIONS[a.kind], `${what}.action`);
  string(a.resource, `${what}.action.resource`);
  if (a.kind === "apply") string(a.manifest, `${what}.action.manifest`);
  if (a.kind === "scale" && !(Number.isInteger(a.replicas) && a.replicas >= 0 && a.replicas <= 0xffffffff)) {
    throw new Error(`${what}.action.replicas is not a u32`);
  }
  if (!PRIORITIES.includes(i.priority)) throw new Error(`${what}.priority is not one of ${PRIORITIES.join(", ")}`);
  if (!BLAST_RADII.includes(i.blast_radius)) throw new Error(`${what}.blast_radius is not one of ${BLAST_RADII.join(", ")}`);
  nullOr(hexOf(64))(i.signature, `${what}.signature`);
}

function checkRecord(r) {
  fields(r, ["type", "seq", "intent_id", "agent", "verdict", "action", "reason", "policies", "intent", "prev", "digest"], "the record");
  count(r.seq, "seq");
  decimalU64(r.intent_id, "intent_id");
  for (const k of ["agent", "verdict", "action"]) string(r[k], k);
  nullOr(string)(r.reason, "reason");
  if (!Array.isArray(r.policies)) throw new Error("policies is not an array");
  r.policies.forEach((p, n) => {
    if (!Array.isArray(p) || p.length !== 2) throw new Error(`policies[${n}] is not a [name, label] pair`);
    string(p[0], `policies[${n}][0]`);
    string(p[1], `policies[${n}][1]`);
  });
  nullOr(checkIntent)(r.intent, "intent");
  unhex(r.prev, 32, "prev");
  unhex(r.digest, 32, "digest");
}

function checkCheckpoint(c) {
  fields(c, ["type", "size", "head", "root", "frontier", "signature"], "the checkpoint");
  count(c.size, "size");
  unhex(c.head, 32, "head");
  unhex(c.root, 32, "root");
  if (!Array.isArray(c.frontier)) throw new Error("frontier is not an array");
  c.frontier.forEach((h, n) => unhex(h, 32, `frontier[${n}]`));
  nullOr(hexOf(64))(c.signature, "signature");
}

const HEADER = {
  type: "header",
  format: "floodwall-ledger",
  version: 1,
  from: null,
  hash: "sha256",
  merkle: "rfc6962",
  record_encoding: "floodwall/ledger/record/v2",
  intent_encoding: "floodwall/intent/v1",
  checkpoint_encoding: "floodwall/checkpoint/v1",
};
function checkHeader(h) {
  if (!isObject(h) || h.type !== "header") throw new Error("the first line must be the header");
  if (h.format !== HEADER.format || h.version !== HEADER.version) throw new Error(`unsupported format ${h.format} v${h.version}`);
  fields(h, Object.keys(HEADER), "the header");
  for (const [k, v] of Object.entries(HEADER)) {
    if (v !== null && h[k] !== v) throw new Error(`unsupported encoding: ${k} is ${JSON.stringify(h[k])}, not ${JSON.stringify(v)}`);
  }
  count(h.from, "from");
}

// floodwall's own JSON spelling (src/export.rs, json_str): no whitespace,
// keys in the order written, integers in decimal, and strings escaping only
// '"', '\', and control characters (\n, \r, \t, else \u00xx).
const ESCAPES = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
function canonical(v) {
  if (v === null) return "null";
  if (typeof v === "string") {
    return `"${v.replace(/["\\\u0000-\u001f]/g, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
  }
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v).map(([k, x]) => `${canonical(k)}:${canonical(x)}`).join(",")}}`;
}

// The intent encoding (src/intent.rs, "Signing", v1).
export function intentDigest(i) {
  checkIntent(i, "intent");
  const a = i.action;
  const action =
    a.kind === "apply"
      ? [Buffer.from([0]), field(a.resource), field(a.manifest)]
      : a.kind === "scale"
        ? [Buffer.from([1]), field(a.resource), u32(a.replicas)]
        : [Buffer.from([2]), field(a.resource)];
  return sha256(
    field("floodwall/intent/v1"),
    field(i.agent),
    u64(BigInt(i.id)),
    ...action,
    Buffer.from([PRIORITIES.indexOf(i.priority), BLAST_RADII.indexOf(i.blast_radius)]),
  );
}

// The record a ledger shows for an intent's action (src/intent.rs, Display).
const summary = (a) =>
  a.kind === "apply" ? `apply ${a.resource}` : a.kind === "scale" ? `scale ${a.resource} to ${a.replicas}` : `destroy ${a.resource}`;

// The record encoding (src/ledger.rs, "Record encoding", v2).
export function recordDigest(r) {
  checkRecord(r);
  return hex(
    sha256(
      field("floodwall/ledger/record/v2"),
      unhex(r.prev, 32, "prev"),
      u64(r.seq),
      u64(BigInt(r.intent_id)),
      optional(r.intent === null ? null : intentDigest(r.intent)),
      optional(r.intent?.signature ? unhex(r.intent.signature, 64, "signature") : null),
      field(r.agent),
      field(r.verdict),
      field(r.action),
      optional(r.reason === null ? null : field(r.reason)),
      u64(r.policies.length),
      ...r.policies.flatMap(([name, label]) => [field(name), field(label)]),
    ),
  );
}

// The checkpoint digest (src/checkpoint.rs, Checkpoint::digest).
const checkpointDigest = (c) =>
  sha256(field("floodwall/checkpoint/v1"), u64(c.size), unhex(c.head, 32, "head"), unhex(c.root, 32, "root"));

// RFC 6962 Merkle hashing (src/merkle.rs), kept as a frontier: the roots of
// the perfect subtrees covering the leaves so far, largest first.
const leafHash = (data) => sha256(Buffer.from([0]), data);
const nodeHash = (l, r) => sha256(Buffer.from([1]), l, r);
class Frontier {
  constructor(size = 0, peaks = []) {
    this.size = size;
    this.peaks = peaks;
  }
  push(digest) {
    let node = leafHash(digest);
    for (let s = this.size; s % 2 === 1; s = Math.floor(s / 2)) node = nodeHash(this.peaks.pop(), node);
    this.peaks.push(node);
    this.size += 1;
  }
  root() {
    if (this.peaks.length === 0) return sha256(Buffer.alloc(0));
    return this.peaks.slice(0, -1).reduceRight((acc, peak) => nodeHash(peak, acc), this.peaks.at(-1));
  }
}
const popcount = (n) => n.toString(2).split("").filter((b) => b === "1").length;

// Ed25519 public keys are refused as floodwall refuses them
// (src/ed25519.rs, VerifyingKey::from_bytes): a y that is not below p, a y
// with no curve point, "negative zero", and the eight small-order points,
// for which one fixed signature verifies every message.
const P = 2n ** 255n - 19n;
const modpow = (b, e) => {
  let r = 1n;
  for (b %= P; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) r = (r * b) % P;
  return r;
};
const D = (((-121665n * modpow(121666n, P - 2n)) % P) + P) % P;
const SMALL_ORDER = new Set([
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000000000000000000000000080",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
]);
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
function publicKey(h, what) {
  const bytes = unhex(h, 32, what);
  const y = BigInt(`0x${hex(Buffer.from(bytes).reverse())}`) & ((1n << 255n) - 1n);
  const xSign = bytes[31] >> 7;
  // x^2 = (y^2 - 1) / (d y^2 + 1), which must be a square.
  const x2 = (((y * y - 1n) * modpow(D * y * y + 1n, P - 2n)) % P + P) % P;
  if (y >= P || (x2 !== 0n && modpow(x2, (P - 1n) / 2n) !== 1n) || (x2 === 0n && xSign === 1)) {
    throw new Error(`${what} is not a valid Ed25519 public key`);
  }
  if (SMALL_ORDER.has(h)) throw new Error(`${what} is a weak, small-order Ed25519 key`);
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519, bytes]), format: "der", type: "spki" });
}
const signedBy = (key, message, sigHex) => sigHex !== null && edVerify(null, message, key, unhex(sigHex, 64, "signature"));

/**
 * Check a parsed keys file and load its keys: {"plane": hex|null, "agents":
 * {name: hex}, "retired": {name: [hex, ...]}}, "retired" optional. Throws
 * unless it is exactly that.
 */
export function loadKeys(keys) {
  if (!isObject(keys)) throw new Error("the keys file is not a JSON object");
  fields(keys, Object.hasOwn(keys, "retired") ? ["plane", "agents", "retired"] : ["plane", "agents"], "the keys file", false);
  const plane = keys.plane === null ? null : publicKey(keys.plane, "the plane key");
  if (!isObject(keys.agents)) throw new Error("the keys file's agents is not a JSON object");
  const retired = keys.retired ?? {};
  if (!isObject(retired)) throw new Error("the keys file's retired is not a JSON object");
  const agents = new Map();
  for (const [name, k] of Object.entries(keys.agents)) agents.set(name, [publicKey(k, `${name}'s key`)]);
  for (const [name, ks] of Object.entries(retired)) {
    if (!Array.isArray(ks)) throw new Error(`${name}'s retired keys are not an array`);
    agents.set(name, [...(agents.get(name) ?? []), ...ks.map((k, n) => publicKey(k, `${name}'s retired key ${n}`))]);
  }
  return { plane, agents };
}

/**
 * Verify an export. `text` is the JSON Lines file; `keys` is the parsed
 * keys file, or null to check hashes only. Returns a summary, or throws an
 * Error whose message starts with the 1-based line number of the first
 * problem.
 */
export function verifyLedger(text, keys = null) {
  const keyring = keys === null ? null : loadKeys(keys);
  if (text.includes("\r")) throw new Error("line 1: the export must use \\n line endings");
  const lines = text.split("\n");
  if (lines.at(-1) !== "") throw new Error(`line ${lines.length}: the last line is not terminated by \\n`);
  lines.pop();
  if (lines.length === 0) throw new Error("line 1: the export is empty");

  let from = 0;
  let anchored = false;
  let seq = 0;
  let prev = GENESIS;
  let frontier = new Frontier();
  let lastCheckpoint = null;
  let records = 0;
  let checkpoints = 0;
  let signatures = 0;

  lines.forEach((line, i) => {
    const at = i + 1;
    const fail = (what) => {
      throw new Error(what);
    };
    try {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        fail(`not JSON (${e.message})`);
      }
      if (at === 1) {
        checkHeader(obj);
      } else if (obj?.type === "record") {
        checkRecord(obj);
      } else if (obj?.type === "checkpoint") {
        checkCheckpoint(obj);
      } else {
        fail(`unknown line type ${JSON.stringify(obj?.type)}`);
      }
      if (canonical(obj) !== line) fail("the line is not written as floodwall writes it (spacing, key order, duplicate keys or escapes)");

      if (at === 1) {
        from = obj.from;
        anchored = from === 0;
        return;
      }
      if (!anchored) {
        // A suffix export: start from the trusted checkpoint.
        if (obj.type !== "checkpoint" || obj.size !== from) fail(`a suffix export must start with the checkpoint at ${from}`);
        if (obj.frontier.length !== popcount(from)) fail("the trusted checkpoint's frontier has the wrong length");
        frontier = new Frontier(from, obj.frontier.map((h) => Buffer.from(h, "hex")));
        if (hex(frontier.root()) !== obj.root) fail("the trusted checkpoint's frontier does not fold to its root");
        if (keyring?.plane && !signedBy(keyring.plane, checkpointDigest(obj), obj.signature)) {
          fail("the trusted checkpoint is not signed by the plane");
        }
        anchored = true;
        lastCheckpoint = from;
        seq = from;
        prev = obj.head;
        checkpoints += 1;
        return;
      }
      if (obj.type === "record") {
        if (obj.seq !== seq) fail(`expected record ${seq}, found ${obj.seq}`);
        if (obj.prev !== prev) fail(`record ${seq} does not link to the record before it`);
        if (recordDigest(obj) !== obj.digest) fail(`record ${seq} does not match its digest`);
        const intent = obj.intent;
        if (intent !== null && (obj.intent_id !== intent.id || obj.agent !== intent.agent || obj.action !== summary(intent.action))) {
          fail(`record ${seq} shows a different request from the intent it holds`);
        }
        if (keyring) {
          if (intent === null) fail(`record ${seq} is not about a signed intent`);
          if (intent.signature === null) fail(`record ${seq}'s intent is not signed`);
          const candidates = keyring.agents.get(intent.agent) ?? [];
          if (candidates.length === 0) fail(`record ${seq} names ${JSON.stringify(intent.agent)}, who has no key`);
          const digest = intentDigest(intent);
          if (!candidates.some((key) => signedBy(key, digest, intent.signature))) fail(`record ${seq} is not signed by ${intent.agent}`);
          signatures += 1;
        }
        frontier.push(Buffer.from(obj.digest, "hex"));
        prev = obj.digest;
        seq += 1;
        records += 1;
      } else {
        if (obj.size !== seq) fail(`a checkpoint of size ${obj.size} after ${seq} records`);
        if (lastCheckpoint !== null && obj.size <= lastCheckpoint) fail(`a second checkpoint at size ${obj.size}: checkpoint sizes must strictly increase`);
        if (obj.head !== prev) fail(`checkpoint ${obj.size} has the wrong head`);
        if (obj.root !== hex(frontier.root())) fail(`checkpoint ${obj.size} has the wrong Merkle root`);
        if (obj.frontier.length !== frontier.peaks.length || obj.frontier.some((h, n) => h !== hex(frontier.peaks[n]))) {
          fail(`checkpoint ${obj.size} has the wrong frontier`);
        }
        if (keyring?.plane && !signedBy(keyring.plane, checkpointDigest(obj), obj.signature)) fail(`checkpoint ${obj.size} is not signed by the plane`);
        lastCheckpoint = obj.size;
        checkpoints += 1;
      }
    } catch (e) {
      throw new Error(`line ${at}: ${e.message}`);
    }
  });
  if (!anchored) throw new Error(`line ${lines.length + 1}: the export ends before the checkpoint at ${from} it starts from`);
  return { from, records, checkpoints, signatures, head: prev, size: seq };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    console.error("usage: node tools/verify-ledger.mjs LEDGER.jsonl [KEYS.json]");
    process.exit(2);
  }
  const [ledgerPath, keysPath] = args;
  // Strict UTF-8: invalid bytes are an error, not U+FFFD.
  const readText = (path) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  let keys = null;
  if (keysPath !== undefined) {
    try {
      keys = JSON.parse(readText(keysPath));
      loadKeys(keys);
    } catch (e) {
      console.error(`FAILED: the keys file ${keysPath}: ${e.message}`);
      process.exit(1);
    }
  }
  try {
    const s = verifyLedger(readText(ledgerPath), keys);
    const scope = s.from > 0 ? `records ${s.from}..${s.size}, from the checkpoint at ${s.from}` : `${s.size} records from genesis`;
    console.log(`ok: ${scope}; ${s.checkpoints} checkpoints; head ${s.head}`);
    if (keys) console.log(`ok: ${s.signatures} agent signatures${keys.plane ? " and every checkpoint signature" : ""} verified`);
  } catch (e) {
    console.error(`FAILED: ${ledgerPath} ${e.message}`);
    process.exit(1);
  }
}
