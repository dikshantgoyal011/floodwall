// Routes, navigation and copy for the console under /app. The console is a
// preview: it is not linked from the landing page and asks not to be indexed.

import type { Verdict } from "../types";
import type { ActionKind, BlastRadius, IntentStatus, IntentStep, PlaneState, Priority } from "../types/console";

/** Every console URL in one place, so links and the route table agree. */
export const CONSOLE_PATHS = {
  overview: "/app",
  intents: "/app/intents",
  newIntent: "/app/intents/new",
  intent: (id: number | string) => `/app/intents/${id}`,
  hold: "/app/hold",
  ledger: "/app/ledger",
  policies: "/app/policies",
} as const;

export const CONSOLE_NAV = [
  { to: CONSOLE_PATHS.overview, label: "Overview", end: true },
  { to: CONSOLE_PATHS.intents, label: "Intents", end: false },
  { to: CONSOLE_PATHS.hold, label: "Hold queue", end: false },
  { to: CONSOLE_PATHS.ledger, label: "Ledger", end: false },
  { to: CONSOLE_PATHS.policies, label: "Policies", end: false },
];

/** The operator name recorded on releases and expiries until there is auth. */
export const OPERATOR = "you";

export const PRIORITIES: Priority[] = ["bulk", "normal", "urgent", "pager"];
export const BLAST_RADII: BlastRadius[] = ["cell", "service", "region", "global"];
export const ACTION_KINDS: ActionKind[] = ["apply", "scale", "destroy"];

export const PRIORITY_RANK: Record<Priority, number> = { bulk: 0, normal: 1, urgent: 2, pager: 3 };

/** The badge color for each intent status and gate verdict. */
export const STATUS_TONE: Record<IntentStatus | Verdict, string> = {
  queued: "neutral",
  "in-flight": "info",
  held: "warn",
  rejected: "bad",
  expired: "neutral",
  succeeded: "good",
  failed: "bad",
  admit: "good",
  defer: "warn",
  reject: "bad",
};

const countStatus = (status: IntentStatus) => (state: PlaneState) =>
  state.intents.filter((intent) => intent.status === status).length;

export const OVERVIEW_STATS = [
  { label: "Queued", hint: "Waiting for the gate", value: countStatus("queued") },
  { label: "In flight", hint: "Admitted, not reported back", value: countStatus("in-flight") },
  { label: "On hold", hint: "Deferred, needs a human", value: countStatus("held") },
  { label: "Ledger records", hint: "Hash-chained", value: (state: PlaneState) => state.ledger.length },
];

export const INTENT_FILTERS: { key: string; label: string; statuses?: IntentStatus[] }[] = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued", statuses: ["queued"] },
  { key: "in-flight", label: "In flight", statuses: ["in-flight"] },
  { key: "held", label: "On hold", statuses: ["held"] },
  { key: "done", label: "Done", statuses: ["succeeded", "failed", "rejected", "expired"] },
];

export const INTENT_COLUMNS = ["ID", "Agent", "Action", "Priority", "Blast", "Status"];
export const LEDGER_COLUMNS = ["Seq", "Tick", "Intent", "Kind", "Summary", "Digest"];

/** What a person can do next, by where the intent is in the flow. */
export const INTENT_STEPS: Partial<Record<IntentStatus, IntentStep[]>> = {
  queued: [{ label: "Run tick", event: () => ({ type: "tick" }) }],
  held: [
    { label: "Expire", secondary: true, event: (id) => ({ type: "expire", id, by: OPERATOR }) },
    { label: "Release", event: (id) => ({ type: "release", id, by: OPERATOR }) },
  ],
  "in-flight": [
    { label: "Report failed", secondary: true, event: (id) => ({ type: "complete", id, outcome: "failed" }) },
    { label: "Report succeeded", event: (id) => ({ type: "complete", id, outcome: "succeeded" }) },
  ],
};
