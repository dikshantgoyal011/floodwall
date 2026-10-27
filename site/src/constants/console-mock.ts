// DUMMY DATA - throwaway. Stands in for the Rust plane until the console is
// wired to it. Delete this file once real data flows in.

import type { Verdict } from "../types";
import type { Intent, LedgerEvent } from "../types/console";

export const MOCK_AGENTS = ["reconciler-7", "deployer", "autoscaler", "migrator", "chaos-monkey"];

/** Mirrors ResourceAllowlist in src/policy.rs. */
export const MOCK_ALLOWLIST = ["web", "api", "cache", "worker"];

export const MOCK_POLICIES: { name: string; rule: string; verdict: Verdict }[] = [
  {
    name: "no-global-destroy",
    rule: "A destructive change with a Global blast radius is rejected.",
    verdict: "reject",
  },
  {
    name: "blast-needs-priority",
    rule: "Region and Global need Urgent or higher; Service needs Normal or higher.",
    verdict: "reject",
  },
  {
    name: "resource-allowlist",
    rule: `Resources off the list (${MOCK_ALLOWLIST.join(", ")}) are deferred to the hold queue.`,
    verdict: "defer",
  },
];

/** The seed intents, before the gate has filled in their verdicts. */
export const MOCK_INTENTS: Intent[] = [
  {
    id: 101,
    agent: "reconciler-7",
    action: { kind: "scale", resource: "web", detail: "5" },
    priority: "normal",
    blast: "service",
    status: "succeeded",
    submittedAt: 0,
  },
  {
    id: 102,
    agent: "deployer",
    action: { kind: "apply", resource: "billing", detail: "billing-v2" },
    priority: "normal",
    blast: "service",
    status: "held",
    submittedAt: 1,
  },
  {
    id: 103,
    agent: "chaos-monkey",
    action: { kind: "destroy", resource: "api" },
    priority: "pager",
    blast: "global",
    status: "rejected",
    submittedAt: 1,
  },
  {
    id: 104,
    agent: "autoscaler",
    action: { kind: "scale", resource: "cache", detail: "8" },
    priority: "urgent",
    blast: "service",
    status: "in-flight",
    submittedAt: 2,
  },
  {
    id: 105,
    agent: "migrator",
    action: { kind: "apply", resource: "api", detail: "schema-v12" },
    priority: "normal",
    blast: "service",
    status: "queued",
    submittedAt: 3,
  },
  {
    id: 106,
    agent: "reconciler-7",
    action: { kind: "apply", resource: "search", detail: "search-v4" },
    priority: "urgent",
    blast: "region",
    status: "queued",
    submittedAt: 3,
  },
  {
    id: 107,
    agent: "autoscaler",
    action: { kind: "scale", resource: "worker", detail: "12" },
    priority: "bulk",
    blast: "region",
    status: "queued",
    submittedAt: 4,
  },
];

/** The ledger events that match the seed intents above. */
export const MOCK_LEDGER_EVENTS: LedgerEvent[] = [
  { tick: 0, intentId: 101, agent: "reconciler-7", kind: "decision", verdict: "admit", summary: "scale web to 5" },
  {
    tick: 1,
    intentId: 102,
    agent: "deployer",
    kind: "decision",
    verdict: "defer",
    summary: "resource 'billing' is not on the allowlist",
  },
  {
    tick: 1,
    intentId: 103,
    agent: "chaos-monkey",
    kind: "decision",
    verdict: "reject",
    summary: "destructive global change requires human sign-off",
  },
  { tick: 2, intentId: 101, agent: "reconciler-7", kind: "outcome", summary: "succeeded" },
  { tick: 2, intentId: 104, agent: "autoscaler", kind: "decision", verdict: "admit", summary: "scale cache to 8" },
];

export const MOCK_START_TICK = 5;
