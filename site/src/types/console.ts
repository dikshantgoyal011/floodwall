// Console-side shapes of the crate's types (src/intent.rs, src/policy.rs,
// src/ledger.rs), trimmed to what the console screens show.

import type { Verdict } from ".";

export type ActionKind = "apply" | "scale" | "destroy";
export type Priority = "bulk" | "normal" | "urgent" | "pager";
export type BlastRadius = "cell" | "service" | "region" | "global";

export type IntentStatus = "queued" | "in-flight" | "held" | "rejected" | "expired" | "succeeded" | "failed";

export type Action = {
  kind: ActionKind;
  resource: string;
  /** Manifest for apply, replica count for scale. */
  detail?: string;
};

export type PolicyResult = { policy: string; verdict: Verdict; reason?: string };

export type Intent = {
  id: number;
  agent: string;
  action: Action;
  priority: Priority;
  blast: BlastRadius;
  status: IntentStatus;
  submittedAt: number;
  verdicts?: PolicyResult[];
  releasedBy?: string;
};

/** What an agent proposes; the plane assigns the id, status and tick. */
export type IntentDraft = Omit<Intent, "id" | "status" | "submittedAt">;

export type LedgerRecord = {
  seq: number;
  tick: number;
  intentId: number;
  agent: string;
  kind: "decision" | "release" | "expiry" | "outcome";
  verdict?: Verdict;
  summary: string;
  prev: string;
  digest: string;
};

/** A ledger record before the chain gives it a seq and digests. */
export type LedgerEvent = Omit<LedgerRecord, "seq" | "digest" | "prev">;

/** In-memory plane state for the console. */
export type PlaneState = { tick: number; intents: Intent[]; ledger: LedgerRecord[] };

/** Each event stands in for a call into the Rust plane. */
export type PlaneEvent =
  | { type: "submit"; id: number; intent: IntentDraft }
  | { type: "tick" }
  | { type: "release"; id: number; by: string }
  | { type: "expire"; id: number; by: string }
  | { type: "complete"; id: number; outcome: "succeeded" | "failed" };

/** A button that moves an intent to its next step. */
export type IntentStep = {
  label: string;
  secondary?: boolean;
  event: (id: number) => PlaneEvent;
};
