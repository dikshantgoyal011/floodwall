// A fake gate for the console: the three reference policies in src/policy.rs,
// re-done in TS. Goes away once the console calls the Rust plane.

import { PRIORITY_RANK } from "../constants/console";
import { MOCK_ALLOWLIST } from "../constants/console-mock";
import type { Verdict } from "../types";
import type { Action, Intent, PolicyResult, Priority } from "../types/console";

/** Runs every policy on `intent`. `waiveDeferrals` is what a human release does. */
export function mockGate(intent: Intent, waiveDeferrals = false): PolicyResult[] {
  const { action, blast, priority } = intent;
  const destructive = action.kind === "destroy" || (action.kind === "scale" && action.detail === "0");
  const needed: Priority = blast === "global" || blast === "region" ? "urgent" : blast === "service" ? "normal" : "bulk";

  return [
    blast === "global" && destructive
      ? { policy: "no-global-destroy", verdict: "reject", reason: "destructive global change requires human sign-off" }
      : { policy: "no-global-destroy", verdict: "admit" },
    PRIORITY_RANK[priority] >= PRIORITY_RANK[needed]
      ? { policy: "blast-needs-priority", verdict: "admit" }
      : {
          policy: "blast-needs-priority",
          verdict: "reject",
          reason: `${blast} blast radius needs priority >= ${needed}, got ${priority}`,
        },
    MOCK_ALLOWLIST.includes(action.resource)
      ? { policy: "resource-allowlist", verdict: "admit" }
      : waiveDeferrals
        ? { policy: "resource-allowlist", verdict: "admit", reason: "deferral waived on release" }
        : { policy: "resource-allowlist", verdict: "defer", reason: `resource '${action.resource}' is not on the allowlist` },
  ];
}

/** Deny-overrides: the harshest verdict wins. */
export function mockCombine(results: PolicyResult[]): Verdict {
  if (results.some((r) => r.verdict === "reject")) return "reject";
  if (results.some((r) => r.verdict === "defer")) return "defer";
  return "admit";
}

export function describeAction({ kind, resource, detail }: Action) {
  if (kind === "scale") return `scale ${resource} to ${detail ?? "?"}`;
  if (kind === "apply") return `apply ${detail ?? "manifest"} to ${resource}`;
  return `destroy ${resource}`;
}

/** A replica count: a whole number, at least 0, written without padding ("05" is "5"). */
export function parseReplicas(value: string): string | null {
  const trimmed = value.trim();
  const n = Number(trimmed);
  return trimmed !== "" && Number.isInteger(n) && n >= 0 ? String(n) : null;
}
