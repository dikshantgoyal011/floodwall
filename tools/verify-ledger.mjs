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
//   - every record is at the next position, links to the one before it,
//     and has the digest its fields give;
//   - every checkpoint matches the records so far: chain head, RFC 6962
//     Merkle root, and frontier;
//   - with KEYS.json ({"plane": hex|null, "agents": {name: hex}}): every
//     checkpoint is signed by the plane's key, and every record carries
//     its agent's Ed25519 signature of its intent digest.
// A suffix export (header "from" > 0) starts from the checkpoint on its
// second line, which the auditor trusts; it must be signed when a plane
// key is given.
//
// Exits 0 and prints a summary if everything checks out; otherwise prints
// the first problem, with its line number, and exits 1.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GENESIS = "0".repeat(64);
const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
const hex = (b) => Buffer.from(b).toString("hex");
const unhex = (h, bytes, what) => {
  if (typeof h !== "string" || h.length !== bytes * 2 || !/^[0-9a-f]*$/.test(h)) {
    throw new Error(`${what} is not ${bytes} bytes of lowercase hex`);
  }
  return Buffer.from(h, "hex");
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const field = (s) => {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([u64(bytes.length), bytes]);
};
const optional = (h, bytes, what) =>
  h === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), unhex(h, bytes, what)]);

// The record encoding (src/ledger.rs, "Record encoding", v2).
export function recordDigest(r) {
  if (!/^(0|[1-9][0-9]*)$/.test(r.intent_id) || BigInt(r.intent_id) >= 1n << 64n) {
    throw new Error("intent_id is not a u64 written as a decimal string");
  }
  return hex(
    sha256(
      field("floodwall/ledger/record/v2"),
      unhex(r.prev, 32, "prev"),
      u64(r.seq),
      u64(BigInt(r.intent_id)),
      optional(r.intent_digest, 32, "intent_digest"),
      optional(r.signature, 64, "signature"),
      field(r.agent),
      field(r.verdict),
      field(r.action),
      r.reason === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), field(r.reason)]),
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

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
function publicKey(h, what) {
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_ED25519, unhex(h, 32, what)]), format: "der", type: "spki" });
  } catch (e) {
    throw new Error(`${what} is not a valid Ed25519 public key (${e.message})`);
  }
}
const signedBy = (key, message, sigHex) => {
  if (sigHex === null) return false;
  try {
    return edVerify(null, message, key, unhex(sigHex, 64, "signature"));
  } catch {
    return false;
  }
};

/**
 * Verify an export. `text` is the JSON Lines file; `keys` is the parsed
 * keys file or null. Returns a summary, or throws an Error whose message
 * starts with the 1-based line number of the first problem.
 */
export function verifyLedger(text, keys = null) {
  if (text.includes("\r")) throw new Error("line 1: the export must use \\n line endings");
  const lines = text.split("\n");
  if (lines.at(-1) !== "") throw new Error(`line ${lines.length}: the last line is not terminated by \\n`);
  lines.pop();

  const planeKey = keys?.plane ? publicKey(keys.plane, "the plane key") : null;
  const agentKeys = new Map(Object.entries(keys?.agents ?? {}).map(([name, k]) => [name, publicKey(k, `${name}'s key`)]));

  let from = null;
  let seq = 0;
  let prev = GENESIS;
  let frontier = new Frontier();
  let records = 0;
  let checkpoints = 0;
  let signatures = 0;

  lines.forEach((line, i) => {
    const at = i + 1;
    const fail = (what) => {
      throw new Error(`line ${at}: ${what}`);
    };
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      fail(`not JSON (${e.message})`);
    }
    try {
      if (at === 1) {
        if (obj.type !== "header") fail("the first line must be the header");
        if (obj.format !== "floodwall-ledger" || obj.version !== 1) fail(`unsupported format ${obj.format} v${obj.version}`);
        if (obj.record_encoding !== "floodwall/ledger/record/v2" || obj.merkle !== "rfc6962" || obj.checkpoint_encoding !== "floodwall/checkpoint/v1") {
          fail("unsupported encoding");
        }
        if (!Number.isSafeInteger(obj.from) || obj.from < 0) fail("bad 'from'");
        from = obj.from;
        return;
      }
      if (from > 0 && at === 2) {
        // A suffix export: start from the trusted checkpoint.
        if (obj.type !== "checkpoint" || obj.size !== from) fail(`a suffix export must start with the checkpoint at ${from}`);
        if (obj.frontier.length !== popcount(from)) fail("the trusted checkpoint's frontier has the wrong length");
        frontier = new Frontier(from, obj.frontier.map((h, n) => unhex(h, 32, `frontier[${n}]`)));
        if (hex(frontier.root()) !== obj.root) fail("the trusted checkpoint's frontier does not fold to its root");
        if (planeKey && !signedBy(planeKey, checkpointDigest(obj), obj.signature)) fail("the trusted checkpoint is not signed by the plane");
        seq = from;
        prev = obj.head;
        checkpoints += 1;
        return;
      }
      if (obj.type === "record") {
        if (obj.seq !== seq) fail(`expected record ${seq}, found ${obj.seq}`);
        if (obj.prev !== prev) fail(`record ${seq} does not link to the record before it`);
        const digest = unhex(obj.digest, 32, "digest");
        if (recordDigest(obj) !== obj.digest) fail(`record ${seq} does not match its digest`);
        if (keys) {
          if (obj.intent_digest === null) fail(`record ${seq} is not about a signed intent`);
          const key = agentKeys.get(obj.agent);
          if (!key) fail(`record ${seq} names ${JSON.stringify(obj.agent)}, who has no key`);
          if (!signedBy(key, unhex(obj.intent_digest, 32, "intent_digest"), obj.signature)) {
            fail(`record ${seq} is not signed by ${obj.agent}`);
          }
          signatures += 1;
        }
        frontier.push(digest);
        prev = obj.digest;
        seq += 1;
        records += 1;
      } else if (obj.type === "checkpoint") {
        if (obj.size !== seq) fail(`a checkpoint of size ${obj.size} after ${seq} records`);
        if (obj.head !== prev) fail(`checkpoint ${obj.size} has the wrong head`);
        if (obj.root !== hex(frontier.root())) fail(`checkpoint ${obj.size} has the wrong Merkle root`);
        if (obj.frontier.length !== frontier.peaks.length || obj.frontier.some((h, n) => h !== hex(frontier.peaks[n]))) {
          fail(`checkpoint ${obj.size} has the wrong frontier`);
        }
        if (planeKey && !signedBy(planeKey, checkpointDigest(obj), obj.signature)) fail(`checkpoint ${obj.size} is not signed by the plane`);
        checkpoints += 1;
      } else {
        fail(`unknown line type ${JSON.stringify(obj.type)}`);
      }
    } catch (e) {
      throw e.message.startsWith("line ") ? e : new Error(`line ${at}: ${e.message}`);
    }
  });
  if (from === null) throw new Error("line 1: the export is empty");
  return { from, records, checkpoints, signatures, head: prev, size: seq };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [ledgerPath, keysPath] = process.argv.slice(2);
  if (!ledgerPath) {
    console.error("usage: node tools/verify-ledger.mjs LEDGER.jsonl [KEYS.json]");
    process.exit(2);
  }
  let keys = null;
  if (keysPath) {
    try {
      keys = JSON.parse(readFileSync(keysPath, "utf8"));
    } catch (e) {
      console.error(`FAILED: cannot read the keys file ${keysPath}: ${e.message}`);
      process.exit(1);
    }
  }
  try {
    const s = verifyLedger(readFileSync(ledgerPath, "utf8"), keys);
    const scope = s.from > 0 ? `records ${s.from}..${s.size}, from the checkpoint at ${s.from}` : `${s.size} records from genesis`;
    console.log(`ok: ${scope}; ${s.checkpoints} checkpoints; head ${s.head}`);
    if (keys) console.log(`ok: ${s.signatures} agent signatures${keys.plane ? " and every checkpoint signature" : ""} verified`);
  } catch (e) {
    console.error(`FAILED: ${ledgerPath} ${e.message}`);
    process.exit(1);
  }
}
