// A fake hash chain for the console's ledger screen.

import type { LedgerEvent, LedgerRecord } from "../types/console";

/** Not SHA-256: a stable-looking hex string so the ledger screen has digests to show. */
export function mockDigest(input: string): string {
  let out = "";
  let h = 2166136261;
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) + round;
      h = Math.imul(h, 16777619) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** Appends `event`, linking it to the digest of the record before. */
export function mockAppend(ledger: LedgerRecord[], event: LedgerEvent): LedgerRecord[] {
  const prev = ledger.at(-1)?.digest ?? "0".repeat(64);
  const seq = ledger.length;
  return [...ledger, { ...event, seq, prev, digest: mockDigest(`${prev}|${seq}|${JSON.stringify(event)}`) }];
}

/** Stand-in for Ledger::verify(): checks each record links to the one before. */
export function chainIntact(ledger: LedgerRecord[]) {
  return ledger.every((r, i) => i === 0 || r.prev === ledger[i - 1].digest);
}

export function shortDigest(digest: string) {
  return `${digest.slice(0, 8)}…${digest.slice(-8)}`;
}
