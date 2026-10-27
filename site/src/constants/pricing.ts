// Plans, prices and copy for the /pricing page. The prices are the working
// proposal for Floodwall Cloud; they live here so they change in one place.

import { REPO_URL } from "./links";

export const PRICING_PATH = "/pricing";

/** Hosted plans open by invitation: requests go to the team's waitlist form. */
export const EARLY_ACCESS_URL = "https://tally.so/r/6DJeoP";

export type PricingPlan = {
  name: string;
  price: string;
  /** What the price is per, shown under it. */
  priceNote: string;
  summary: string;
  /** A worked month's bill, for the usage-based plans. */
  typical?: { spend: string; basis: string };
  features: string[];
  cta: { label: string; href: string };
  /** The plan most teams start on, set apart from the others. */
  featured?: boolean;
};

const EARLY_ACCESS = { label: "Request early access", href: EARLY_ACCESS_URL };

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Self-host",
    price: "Free",
    priceNote: "forever, MIT licensed",
    summary: "The open-source crate. Run the wall inside your own control plane.",
    features: [
      "Admission, scheduler and policy gate",
      "Hold queue with human release",
      "Signed, hash-chained ledger",
      "Independent ledger verifier",
    ],
    cta: { label: "View the Crate", href: REPO_URL },
  },
  {
    name: "Free",
    price: "$0",
    priceNote: "per month",
    summary: "Floodwall Cloud for a team's first agents.",
    features: ["1 plane", "25,000 decisions a month", "7-day hosted ledger", "Up to 3 approvers", "Community support"],
    cta: EARLY_ACCESS,
  },
  {
    name: "Launch",
    price: "$0.40",
    priceNote: "per 1,000 decisions",
    summary: "For teams putting agents on production changes.",
    typical: { spend: "$20", basis: "50,000 decisions" },
    features: [
      "Up to 5 planes",
      "90-day hosted ledger",
      "Unlimited approvers",
      "Approvals and alerts in Slack",
      "Email support",
    ],
    cta: EARLY_ACCESS,
    featured: true,
  },
  {
    name: "Scale",
    price: "$0.60",
    priceNote: "per 1,000 decisions",
    summary: "For fleets where every change needs an audit trail.",
    typical: { spend: "$600", basis: "1M decisions" },
    features: [
      "Unlimited planes",
      "1-year hosted ledger, exported to your bucket",
      "SSO and approver roles",
      "Signed checkpoints, verified for you",
      "99.9% uptime SLA and priority support",
    ],
    cta: EARLY_ACCESS,
  },
];

export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  copy: "Support for self-hosted planes, compliance evidence, custom retention and contracts.",
  cta: { label: "Talk to us", href: EARLY_ACCESS_URL },
};

/** What every plan, self-hosted or not, gets from the crate itself. */
export const INCLUDED_EVERYWHERE = [
  {
    title: "Deny-overrides gate",
    copy: "One hard reject blocks a change, however many policies admit it.",
  },
  {
    title: "Tamper-evident ledger",
    copy: "Every decision chained with SHA-256 and signed with Ed25519.",
  },
  {
    title: "Independent audit",
    copy: "Check any ledger export with the open verifier, no Floodwall code needed.",
  },
  {
    title: "Human in the loop",
    copy: "Deferred changes wait for a person to release or expire them.",
  },
];

/** One row per feature, one value per plan in PRICING_PLANS order. */
export const PRICING_COMPARISON: { feature: string; values: string[] }[] = [
  { feature: "Price", values: ["Free", "$0", "$0.40 per 1k decisions", "$0.60 per 1k decisions"] },
  { feature: "Decisions", values: ["Unlimited, on your hardware", "25,000 a month", "Usage-based", "Usage-based"] },
  { feature: "Planes", values: ["Unlimited", "1", "Up to 5", "Unlimited"] },
  { feature: "Hosted ledger", values: ["You keep it", "7 days", "90 days", "1 year, plus export"] },
  { feature: "Approvers", values: ["Unlimited", "Up to 3", "Unlimited", "Unlimited"] },
  { feature: "Slack approvals and alerts", values: ["—", "—", "Included", "Included"] },
  { feature: "SSO and approver roles", values: ["—", "—", "—", "Included"] },
  { feature: "Checkpoints verified for you", values: ["Run the verifier", "—", "—", "Included"] },
  { feature: "Uptime SLA", values: ["—", "—", "—", "99.9%"] },
  { feature: "Support", values: ["Community", "Community", "Email", "Priority"] },
];

export const PRICING_PROGRAMS = [
  {
    title: "Open source",
    copy: "Launch at no cost for open-source projects that gate their releases with Floodwall.",
  },
  {
    title: "Startups",
    copy: "Credits for early-stage teams putting agents on production changes.",
  },
];

export const PRICING_FAQ = [
  {
    question: "What is a decision?",
    answer:
      "One intent the gate rules on: admitted, deferred or rejected. Arrivals, releases, expiries and outcomes are recorded in the ledger at no charge.",
  },
  {
    question: "Is Floodwall open source?",
    answer:
      "Yes. The crate is MIT licensed on GitHub, and Floodwall Cloud runs the same crate. Cloud adds the hosting: the ledger kept for you, the console, approvals and sign-in.",
  },
  {
    question: "Can I run it myself?",
    answer:
      "Yes, for free, with every part of the wall. You run the plane, keep the ledger and wire approvals into your own tools.",
  },
  {
    question: "How do I estimate my bill?",
    answer:
      "Count the changes your agents propose in a month. A fleet proposing 2,000 changes a day makes about 60,000 decisions, which is $24 on Launch.",
  },
  {
    question: "What does Floodwall Cloud store?",
    answer:
      "The ledger: each decision's action, reason, every policy's verdict and the agent's signature, for your plan's retention. Your infrastructure stays where it is: Floodwall decides, and you apply the change.",
  },
  {
    question: "When can I sign up?",
    answer:
      "Hosted plans open by invitation during early access. The prices here are for planning and may change before general availability.",
  },
];
