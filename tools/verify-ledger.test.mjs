// Tamper tests for the independent verifier, run against real exports:
//
//   cargo run --release -- --export target/audit
//   cargo test --test export_fixture
//   node --test tools/
//
// LEDGER_DIR and FIXTURE_DIR override where the exports are read from.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKeys, recordDigest, verifyLedger } from "./verify-ledger.mjs";

const ledgerDir = process.env.LEDGER_DIR ?? "target/audit";
const fixtureDir = process.env.FIXTURE_DIR ?? "target/export-fixture";
const read = (dir, name) => readFileSync(join(dir, name), "utf8");
const whole = read(ledgerDir, "ledger.jsonl");
const suffix = read(ledgerDir, "ledger-suffix.jsonl");
const keys = JSON.parse(read(ledgerDir, "keys.json"));
const edge = read(fixtureDir, "edge.jsonl");
const edgeKeys = JSON.parse(read(fixtureDir, "keys.json"));

const lines = (text) => text.split("\n").slice(0, -1);
const join_ = (ls) => ls.join("\n") + "\n";
const recordLines = (text) => lines(text).map((l, i) => [i, JSON.parse(l)]).filter(([, o]) => o.type === "record");
/** Change one parsed line and write it back. */
const edit = (text, index, change) => {
  const ls = lines(text);
  const obj = JSON.parse(ls[index]);
  change(obj);
  ls[index] = JSON.stringify(obj);
  return join_(ls);
};
/** Change one line's text. */
const editText = (text, index, change) => {
  const ls = lines(text);
  ls[index] = change(ls[index]);
  return join_(ls);
};
const fails = (text, k, pattern) => assert.throws(() => verifyLedger(text, k), pattern);

const scratch = mkdtempSync(join(tmpdir(), "verify-ledger-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const script = fileURLToPath(new URL("./verify-ledger.mjs", import.meta.url));
/** Run the CLI on files with these contents (keys null: omit the argument). */
const cli = (ledgerText, keysText = null) => {
  const ledgerPath = join(scratch, "ledger.jsonl");
  writeFileSync(ledgerPath, ledgerText);
  const args = [script, ledgerPath];
  if (keysText !== null) {
    const keysPath = join(scratch, "keys.json");
    writeFileSync(keysPath, keysText);
    args.push(keysPath);
  }
  return spawnSync(process.execPath, args, { encoding: "utf8" });
};

test("the exports verify, with and without keys", () => {
  const s = verifyLedger(whole, keys);
  assert.equal(s.from, 0);
  assert.ok(s.records > 1000 && s.checkpoints > 1);
  assert.equal(s.signatures, s.records);
  assert.equal(verifyLedger(whole).records, s.records);
  const t = verifyLedger(suffix, keys);
  assert.ok(t.from > 0);
  assert.equal(t.head, s.head);
  assert.equal(t.size, s.size);
});

test("the edge-case fixture verifies", () => {
  const s = verifyLedger(edge, edgeKeys);
  assert.equal(s.records, 8);
  assert.equal(verifyLedger(read(fixtureDir, "edge-suffix.jsonl"), edgeKeys).head, s.head);
});

test("an edited record is caught, even with its own digest fixed", () => {
  const [i] = recordLines(whole)[10];
  const flip = (o) => (o.verdict = o.verdict === "admit" ? "reject" : "admit");
  fails(edit(whole, i, flip), null, /record 10 does not match its digest/);
  // Give the edited record a correct digest for its new contents: now the
  // next record no longer links to it.
  const rehashed = edit(whole, i, (o) => {
    flip(o);
    o.digest = recordDigest(o);
  });
  fails(rehashed, null, /record 11 does not link to the record before it/);
});

test("a record must show the request its intent holds", () => {
  const [i, r] = recordLines(whole)[12];
  const rehash = (change) =>
    edit(whole, i, (o) => {
      change(o);
      o.digest = recordDigest(o);
    });
  const mismatch = /record 12 shows a different request from the intent it holds/;
  fails(rehash((o) => (o.action = "destroy everything")), null, mismatch);
  fails(rehash((o) => (o.agent = "someone-else")), null, mismatch);
  fails(rehash((o) => (o.intent_id = String(BigInt(o.intent_id) + 1n))), null, mismatch);
  // Changing the intent itself, consistently, breaks its signature.
  const other = Object.keys(keys.agents).find((a) => a !== r.agent);
  const forged = rehash((o) => {
    o.agent = o.intent.agent = other;
  });
  fails(forged, keys, /record 12 is not signed by/);
});

test("missing, extra and reordered records are caught", () => {
  const ls = lines(whole);
  const [i] = recordLines(whole)[20];
  fails(join_(ls.filter((_, n) => n !== i)), null, /expected record 20, found 21/);
  fails(join_([...ls.slice(0, i + 1), ls[i], ...ls.slice(i + 1)]), null, /expected record 21, found 20/);
  const swapped = [...ls];
  [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
  fails(join_(swapped), null, /line \d+: (expected record|a checkpoint)/);
});

test("forged checkpoints are caught", () => {
  const i = lines(whole).findIndex((l) => l.includes('"type":"checkpoint"'));
  fails(edit(whole, i, (o) => (o.root = "0".repeat(64))), null, /wrong Merkle root/);
  fails(edit(whole, i, (o) => (o.head = "0".repeat(64))), null, /wrong head/);
  fails(edit(whole, i, (o) => o.frontier.reverse() && o.frontier.push("0".repeat(64))), null, /wrong frontier/);
  fails(edit(whole, i, (o) => (o.size += 1)), null, /a checkpoint of size/);
  // An unsigned checkpoint is consistent, but not the plane's.
  const unsigned = edit(whole, i, (o) => (o.signature = null));
  assert.doesNotThrow(() => verifyLedger(unsigned));
  fails(unsigned, keys, /not signed by the plane/);
});

test("checkpoint sizes strictly increase: a signed checkpoint cannot repeat", () => {
  for (const [text, k] of [
    [whole, keys],
    [edge, edgeKeys],
  ]) {
    const ls = lines(text);
    const i = ls.findIndex((l) => l.includes('"type":"checkpoint"'));
    const twice = join_([...ls.slice(0, i + 1), ls[i], ...ls.slice(i + 1)]);
    fails(twice, null, /a second checkpoint at size \d+/);
    fails(twice, k, /a second checkpoint at size \d+/);
  }
  // The edge fixture's genesis checkpoint is the line after the header.
  assert.match(lines(edge)[1], /"type":"checkpoint","size":0,/);
  fails(join_([...lines(edge).slice(0, 2), lines(edge)[1], ...lines(edge).slice(2)]), edgeKeys, /line 3: a second checkpoint at size 0/);
});

test("signatures are checked against the auditor's keys, not the export", () => {
  const swappedKeys = { ...keys, agents: { ...keys.agents, deployer: keys.agents.autoscaler } };
  fails(whole, swappedKeys, /is not signed by deployer/);
  const { deployer, ...withoutDeployer } = keys.agents;
  fails(whole, { ...keys, agents: withoutDeployer }, /"deployer", who has no key/);
  const otherPlane = { ...keys, plane: keys.agents.deployer };
  fails(whole, otherPlane, /not signed by the plane/);
  // A record's signature moved onto another record.
  const recs = recordLines(whole);
  const sig = recs[5][1].intent.signature;
  fails(edit(whole, recs[6][0], (o) => (o.intent.signature = sig)), keys, /does not match its digest/);
  // An unsigned intent, rehashed so the chain holds, is not the agent's.
  const unsigned = edit(whole, recs[6][0], (o) => {
    o.intent.signature = null;
    o.digest = recordDigest(o);
  });
  fails(unsigned, keys, /record 6's intent is not signed/);
});

test("a retired key still verifies its agent's records", () => {
  // Deployer rotated to a new key: the export's records are signed by the
  // old one, now retired.
  const rotated = {
    ...keys,
    agents: { ...keys.agents, deployer: keys.agents.autoscaler },
    retired: { deployer: [keys.agents.deployer] },
  };
  assert.equal(verifyLedger(whole, rotated).signatures, verifyLedger(whole, keys).signatures);
  // Retired keys count only for their own agent.
  fails(whole, { ...rotated, retired: { autoscaler: [keys.agents.deployer] } }, /is not signed by deployer/);
  // An agent with only retired keys is still known.
  const { deployer, ...rest } = keys.agents;
  assert.doesNotThrow(() => verifyLedger(whole, { ...keys, agents: rest, retired: { deployer: [deployer] } }));
});

test("a suffix export must start from a sound, signed checkpoint", () => {
  fails(edit(suffix, 1, (o) => (o.frontier[0] = "0".repeat(64))), null, /does not fold to its root/);
  fails(edit(suffix, 1, (o) => (o.signature = null)), keys, /trusted checkpoint is not signed/);
  fails(edit(suffix, 1, (o) => (o.head = "1".repeat(64))), null, /does not link to the record before it/);
  const ls = lines(suffix);
  fails(join_([ls[0], ...ls.slice(2)]), null, /must start with the checkpoint/);
});

test("a suffix export cut off before its checkpoint is refused", () => {
  const headerOnly = join_([lines(suffix)[0]]);
  assert.match(headerOnly, /"from":[1-9]/);
  fails(headerOnly, null, /line 2: the export ends before the checkpoint at \d+ it starts from/);
  fails(headerOnly, keys, /line 2: the export ends before the checkpoint at \d+ it starts from/);
  const r = cli(headerOnly, JSON.stringify(keys));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ends before the checkpoint/);
  // A whole export needs no checkpoint, and a suffix may end on records
  // after its checkpoint.
  assert.doesNotThrow(() => verifyLedger(join_([lines(whole)[0]])));
  const tail = lines(suffix).filter((l, n) => n < 2 || l.includes('"type":"record"'));
  assert.equal(verifyLedger(join_(tail), keys).checkpoints, 1);
});

test("records are checked against the exact schema before hashing", () => {
  // Each edit keeps every digest and signature valid where it can: the
  // record's digest is recomputed for its edited form, or the edit is one
  // that a lenient hash would not notice. All must still fail.
  const [i, r] = recordLines(edge)[1];
  const numericId = editText(edge, i, (l) => l.replace(`"intent_id":"${r.intent_id}"`, `"intent_id":${r.intent_id}`));
  fails(numericId, edgeKeys, /intent_id is not a u64 written as a decimal string/);
  fails(edit(edge, i, (o) => (o.intent.id = Number(o.intent.id))), edgeKeys, /intent\.id is not a u64/);
  fails(edit(edge, i, (o) => (o.action = [...Buffer.from(o.action, "utf8")])), edgeKeys, /action is not a string/);
  fails(edit(edge, i, (o) => (o.agent = { toString: 1 })), edgeKeys, /agent is not a string/);
  fails(edit(edge, i, (o) => (o.reason = 0)), edgeKeys, /reason is not a string/);
  fails(edit(edge, i, (o) => (o.policies = [[...o.policies[0], "reject"]])), edgeKeys, /policies\[0\] is not a \[name, label\] pair/);
  fails(edit(edge, i, (o) => (o.policies = [["rule"]])), edgeKeys, /policies\[0\] is not a \[name, label\] pair/);
  fails(edit(edge, i, (o) => (o.policies = [["rule", 7]])), edgeKeys, /policies\[0\]\[1\] is not a string/);
  fails(edit(edge, i, (o) => (o.policies = "")), edgeKeys, /policies is not an array/);
  fails(edit(edge, i, (o) => (o.seq = String(o.seq))), edgeKeys, /seq is not a non-negative integer/);
  fails(edit(edge, i, (o) => (o.extra = 1)), edgeKeys, /unknown field "extra"/);
  fails(edit(edge, i, (o) => delete o.reason), edgeKeys, /has no "reason"/);
  fails(edit(edge, i, (o) => (o.intent.action.replicas = 2 ** 32)), edgeKeys, /replicas is not a u32/);
  fails(edit(edge, i, (o) => (o.intent.action.kind = "restart")), edgeKeys, /not an apply, scale or destroy/);
  fails(edit(edge, i, (o) => (o.intent.action.manifest = "x")), edgeKeys, /unknown field "manifest"/);
  fails(edit(edge, i, (o) => (o.intent.priority = 3)), edgeKeys, /priority is not one of/);
  fails(edit(edge, i, (o) => (o.intent.blast_radius = "planet")), edgeKeys, /blast_radius is not one of/);
  fails(edit(edge, i, (o) => (o.intent = "")), edgeKeys, /intent is not a JSON object/);
  // recordDigest itself refuses to hash a malformed record.
  assert.throws(() => recordDigest({ ...r, policies: [["a", "b", "c"]] }), /is not a \[name, label\] pair/);
  assert.throws(() => recordDigest({ ...r, intent_id: 1 }), /intent_id is not a u64/);
});

test("a line must be written exactly as floodwall writes it", () => {
  const [i, r] = recordLines(edge)[2];
  assert.equal(r.agent, "bot");
  assert.ok(verifyLedger(edge, edgeKeys));
  const notCanonical = /line \d+: the line is not written as floodwall writes it/;
  // Each of these parses to exactly the record floodwall wrote, so every
  // digest and signature still checks out, but the bytes differ: another
  // JSON parser could read them differently (a duplicate key, say), or
  // they hide edits from a byte-level diff.
  const variants = [
    (l) => l.replace('"verdict":', '"verdict": '), // whitespace
    (l) => l.replace(/}$/, `,"verdict":${JSON.stringify(r.verdict)}}`), // a duplicate key
    (l) => l.replace(`"seq":${r.seq},`, `"seq":${r.seq}.0,`), // another number spelling
    (l) => l.replace('"agent":"bot"', '"agent":"\\u0062ot"'), // an unneeded escape
  ];
  variants.forEach((change, n) => {
    const text = editText(edge, i, change);
    assert.notEqual(text, edge, `variant ${n} changes the bytes`);
    assert.deepEqual(lines(text).map((l) => JSON.parse(l)), lines(edge).map((l) => JSON.parse(l)), `variant ${n} parses the same`);
    fails(text, edgeKeys, notCanonical);
  });
  // A duplicate key that changes the value JSON.parse sees, with the digest
  // fixed for the last value, is still refused.
  const shadowed = editText(edge, i, (l) => {
    const o = JSON.parse(l);
    o.verdict = "admit";
    o.digest = recordDigest(o);
    return JSON.stringify(o).replace('"verdict":"admit"', `"verdict":${JSON.stringify(r.verdict)},"verdict":"admit"`);
  });
  fails(shadowed, null, notCanonical);
  // Reordered fields parse to the same values, but are not floodwall's.
  const reordered = editText(edge, i, (l) => {
    const { verdict, ...rest } = JSON.parse(l);
    return JSON.stringify({ ...rest, verdict });
  });
  fails(reordered, edgeKeys, /the record does not have its fields in the documented order/);
  fails(edit(edge, 0, (o) => o.from === 0 && delete o.type && (o.type = "header")), null, /the header does not have its fields/);
  const c = lines(edge).findIndex((l) => l.includes('"type":"checkpoint"'));
  const reversed = (l) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(l)).reverse()));
  fails(editText(edge, c, reversed), edgeKeys, /the checkpoint does not have its fields in the documented order/);
  // The keys file is written by hand as often as not: any order will do.
  assert.doesNotThrow(() => verifyLedger(edge, JSON.parse(reversed(JSON.stringify(edgeKeys)))));
  // A lone surrogate would hash as U+FFFD.
  fails(editText(edge, i, (l) => l.replace('"agent":"bot"', '"agent":"\\ud800"')), null, /agent is not a string/);
});

test("malformed files are refused", () => {
  fails(whole.slice(0, -1), null, /not terminated/);
  fails(whole.replace("\n", "\r\n"), null, /\\n line endings/);
  fails(edit(whole, 0, (o) => (o.version = 2)), null, /unsupported format/);
  fails(edit(whole, 0, (o) => (o.record_encoding = "floodwall/ledger/record/v1")), null, /unsupported encoding/);
  fails(edit(whole, 0, (o) => (o.intent_encoding = "floodwall/intent/v0")), null, /unsupported encoding/);
  fails(edit(whole, 0, (o) => (o.extra = true)), null, /unknown field "extra"/);
  fails(edit(whole, 0, (o) => (o.from = -1)), null, /from is not a non-negative integer/);
  const [i] = recordLines(whole)[3];
  fails(edit(whole, i, (o) => (o.intent_id = "-1")), null, /intent_id is not a u64/);
  fails(edit(whole, i, (o) => (o.intent_id = "007")), null, /intent_id is not a u64/);
  fails(edit(whole, i, (o) => (o.intent_id = "18446744073709551616")), null, /intent_id is not a u64/);
  fails(edit(whole, i, (o) => (o.digest = "ABC")), null, /lowercase hex/);
  fails(edit(whole, i, (o) => (o.type = "comment")), null, /unknown line type/);
  const c = lines(whole).findIndex((l) => l.includes('"type":"checkpoint"'));
  fails(edit(whole, c, (o) => (o.frontier = [1])), null, /frontier\[0\] is not 32 bytes/);
  fails(edit(whole, c, (o) => (o.size = "256")), null, /size is not a non-negative integer/);
  fails(join_([...lines(whole).slice(0, 3), "{not json"]), null, /line 4: not JSON/);
  fails(join_([...lines(whole).slice(0, 3), "null"]), null, /line 4: unknown line type/);
  fails("", null, /empty/);
  fails("\n", null, /line 1: not JSON|the first line must be the header/);
});

test("a supplied keys file must be a valid keys object", () => {
  assert.throws(() => loadKeys(null), /not a JSON object/);
  assert.throws(() => loadKeys([]), /not a JSON object/);
  assert.throws(() => loadKeys({ plane: null }), /has no "agents"/);
  assert.throws(() => loadKeys({ ...keys, extra: {} }), /unknown field "extra"/);
  assert.throws(() => loadKeys({ ...keys, agents: [] }), /agents is not a JSON object/);
  assert.throws(() => loadKeys({ ...keys, retired: { deployer: keys.agents.deployer } }), /retired keys are not an array/);
  assert.throws(() => loadKeys({ ...keys, plane: "AB" }), /lowercase hex/);
  // Keys floodwall itself refuses: weak (small-order), "negative zero",
  // a y not below p, and a y with no curve point.
  const identity = "01" + "00".repeat(31);
  assert.throws(() => loadKeys({ ...keys, agents: { deployer: identity } }), /weak, small-order/);
  assert.throws(() => loadKeys({ ...keys, plane: "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa" }), /weak, small-order/);
  assert.throws(() => loadKeys({ ...keys, agents: { deployer: "01" + "00".repeat(30) + "80" } }), /not a valid Ed25519 public key/);
  assert.throws(() => loadKeys({ ...keys, agents: { deployer: "ed" + "ff".repeat(30) + "7f" } }), /not a valid Ed25519 public key/);
  assert.throws(() => loadKeys({ ...keys, agents: { deployer: "02" + "00".repeat(31) } }), /not a valid Ed25519 public key/);
  assert.doesNotThrow(() => loadKeys(keys));
  assert.doesNotThrow(() => loadKeys({ plane: null, agents: {} }));
});

test("the CLI never falls back to hash-only checks for a bad keys file", () => {
  // A consistent export whose checkpoint is not the plane's: only the keys
  // can tell.
  const c = lines(whole).findIndex((l) => l.includes('"type":"checkpoint"'));
  const unsigned = edit(whole, c, (o) => (o.signature = null));
  let r = cli(unsigned, JSON.stringify(keys));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not signed by the plane/);
  for (const bad of ["null", "[]", "5", '"keys"', "{}", '{"plane":null}', "", "{not json"]) {
    r = cli(unsigned, bad);
    assert.equal(r.status, 1, `keys file ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /FAILED: the keys file/);
    assert.equal(r.stdout, "");
  }
  // Invalid UTF-8 is refused, not read as U+FFFD, in either file.
  const badName = Buffer.concat([Buffer.from('{"plane":null,"agents":{"'), Buffer.from([0xff]), Buffer.from(`":"${keys.agents.deployer}"}}`)]);
  r = cli(unsigned, badName);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAILED: the keys file .*not valid/);
  const [i] = recordLines(whole)[0];
  const ls = lines(whole);
  const badLedger = Buffer.concat([Buffer.from(join_(ls.slice(0, i))), Buffer.from([0xff]), Buffer.from(join_(ls.slice(i)))]);
  r = cli(badLedger);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid/);
  // An empty path names no file; it is not the same as leaving it out.
  r = spawnSync(process.execPath, [script, join(scratch, "ledger.jsonl"), ""], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAILED: the keys file/);
  // Omitting the keys file is an explicit choice of hash-only checks.
  r = cli(unsigned);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ok: \d+ records from genesis/);
  assert.doesNotMatch(r.stdout, /signatures/);
  // The real keys file and export pass.
  r = cli(whole, JSON.stringify(keys));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent signatures and every checkpoint signature verified/);
  // Usage errors exit 2.
  assert.equal(spawnSync(process.execPath, [script]).status, 2);
  assert.equal(spawnSync(process.execPath, [script, "a", "b", "c"]).status, 2);
});
