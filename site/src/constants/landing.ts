// Copy for the landing page, kept apart from the markup.

import type { Verdict } from "../types";

/** The hero heading, one span per line, each ending in an emphasized phrase. */
export const HERO_TITLE_LINES = [
  { text: "When ", emphasis: "agents flood" },
  { text: "production, ", emphasis: "hold the line." },
];

export const CRATE_STATS = [
  { value: __CRATE_STATS__.version, label: "shipped" },
  { value: __CRATE_STATS__.dependencies, label: "dependencies" },
  { value: __CRATE_STATS__.tests, label: "tests" },
];

export const MODEL_STAGES = [
  {
    title: "Admission",
    copy: "Per-agent token buckets and a bounded priority queue keep one loop from taking the whole lane.",
  },
  {
    title: "Gate",
    copy: "A deny-overrides policy stack evaluates every intent before it gets near production.",
  },
  {
    title: "Ledger",
    copy: "Every verdict is appended to a hash chain so retroactive edits break verification.",
  },
];

/** The reference policies in src/policy.rs and the verdict each one hands down. */
export const GATE_POLICIES: { name: string; rule: string; verdict: Verdict }[] = [
  {
    name: "no-global-destroy",
    rule: "Destructive global changes need human sign-off.",
    verdict: "reject",
  },
  {
    name: "blast-needs-priority",
    rule: "The wider the blast radius, the more urgent a change must be.",
    verdict: "reject",
  },
  {
    name: "resource-allowlist",
    rule: "Resources off the list wait on hold for a human.",
    verdict: "defer",
  },
];

export const LEDGER_FACTS = [
  "SHA-256 hash chain: each record folds in the previous digest.",
  "With a keyring, Ed25519 signatures prove which agent asked for what.",
  "verify() replays the chain; verify_signatures() checks every signer.",
];

export const LEDGER_ENTRIES: { verdict: Verdict; agent: string; intent: string }[] = [
  { verdict: "admit", agent: "reconciler-7", intent: "scale web" },
  { verdict: "defer", agent: "deployer", intent: "billing off allowlist" },
  { verdict: "reject", agent: "chaos-loop", intent: "global destroy" },
  { verdict: "admit", agent: "autoscaler", intent: "cache replicas" },
  { verdict: "reject", agent: "cost-bot", intent: "bulk region drain" },
  { verdict: "admit", agent: "migrator", intent: "api schema v12" },
];

/** Head digest from the README's demo run, shortened for display. */
export const LEDGER_HEAD_DIGEST = "d68d4329…1236b16c";

export const ROADMAP = [
  {
    version: "0.1",
    title: "The wall",
    copy: "Intent model, admission control, policy gate, ledger, and demo.",
  },
  {
    version: "0.2",
    title: "Scheduler",
    copy: "Serialize wide-blast and same-resource changes while narrow work proceeds.",
  },
  {
    version: "0.3",
    title: "Trustworthy ledger",
    copy: "SHA-256 chain, signed records, and Merkle checkpoints.",
  },
  {
    version: "0.4",
    title: "Replay",
    copy: "Durable append-only state that rebuilds the plane after restart.",
  },
];
