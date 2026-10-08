// Tamper tests for the independent verifier, run against real exports:
//
//   cargo run --release -- --export target/audit
//   cargo test --test export_fixture
//   node --test tools/
//
// LEDGER_DIR and FIXTURE_DIR override where the exports are read from.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { recordDigest, verifyLedger } from "./verify-ledger.mjs";

const ledgerDir = process.env.LEDGER_DIR ?? "target/audit";
const fixtureDir = process.env.FIXTURE_DIR ?? "target/export-fixture";
const read = (dir, name) => readFileSync(join(dir, name), "utf8");
const whole = read(ledgerDir, "ledger.jsonl");
const suffix = read(ledgerDir, "ledger-suffix.jsonl");
const keys = JSON.parse(read(ledgerDir, "keys.json"));

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
const fails = (text, k, pattern) => assert.throws(() => verifyLedger(text, k), pattern);

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
  const k = JSON.parse(read(fixtureDir, "keys.json"));
  const s = verifyLedger(read(fixtureDir, "edge.jsonl"), k);
  assert.equal(s.records, 8);
  assert.equal(verifyLedger(read(fixtureDir, "edge-suffix.jsonl"), k).head, s.head);
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

test("signatures are checked against the auditor's keys, not the export", () => {
  const swappedKeys = { ...keys, agents: { ...keys.agents, deployer: keys.agents.autoscaler } };
  fails(whole, swappedKeys, /is not signed by deployer/);
  const { deployer, ...withoutDeployer } = keys.agents;
  fails(whole, { ...keys, agents: withoutDeployer }, /"deployer", who has no key/);
  const otherPlane = { ...keys, plane: keys.agents.deployer };
  fails(whole, otherPlane, /not signed by the plane/);
  // A record's signature moved onto another record.
  const recs = recordLines(whole);
  const sig = recs[5][1].signature;
  fails(edit(whole, recs[6][0], (o) => (o.signature = sig)), keys, /does not match its digest/);
});

test("a suffix export must start from a sound, signed checkpoint", () => {
  fails(edit(suffix, 1, (o) => (o.frontier[0] = "0".repeat(64))), null, /does not fold to its root/);
  fails(edit(suffix, 1, (o) => (o.signature = null)), keys, /trusted checkpoint is not signed/);
  fails(edit(suffix, 1, (o) => (o.head = "1".repeat(64))), null, /does not link to the record before it/);
  const ls = lines(suffix);
  fails(join_([ls[0], ...ls.slice(2)]), null, /must start with the checkpoint/);
});

test("malformed files are refused", () => {
  fails(whole.slice(0, -1), null, /not terminated/);
  fails(whole.replace("\n", "\r\n"), null, /\\n line endings/);
  fails(edit(whole, 0, (o) => (o.version = 2)), null, /unsupported format/);
  fails(edit(whole, 0, (o) => (o.record_encoding = "floodwall/ledger/record/v1")), null, /unsupported encoding/);
  const [i] = recordLines(whole)[3];
  fails(edit(whole, i, (o) => (o.intent_id = "-1")), null, /intent_id is not a u64/);
  fails(edit(whole, i, (o) => (o.intent_id = "18446744073709551616")), null, /intent_id is not a u64/);
  fails(edit(whole, i, (o) => (o.digest = "ABC")), null, /lowercase hex/);
  fails(edit(whole, i, (o) => (o.type = "comment")), null, /unknown line type/);
  fails(join_([...lines(whole).slice(0, 3), "{not json"]), null, /line 4: not JSON/);
  fails("", null, /empty/);
});
