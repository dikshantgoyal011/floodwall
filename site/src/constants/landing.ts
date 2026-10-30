// Copy and links for the landing page, kept apart from the markup.

export const REPO_URL = "https://github.com/erphq/floodwall";

export const TALLY_ORIGIN = "https://tally.so";
export const WAITLIST_FORM_URL = `${TALLY_ORIGIN}/r/6DJeoP`;
export const WAITLIST_EMBED_URL =
  `${TALLY_ORIGIN}/embed/6DJeoP?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1`;

/** Encoded widths of public/footer-water*.webp; the largest is footer-water.webp itself. */
export const FOOTER_PRINT_WIDTHS = [720, 1082, 1600, 2164] as const;

export type Link = { label: string; href: string };

/** In-page sections the primary nav links to, in page order. */
export const NAV_SECTIONS = [
  { id: "home", label: "Home" },
  { id: "line", label: "Line" },
  { id: "model", label: "Model" },
  { id: "gate", label: "Gate" },
  { id: "ledger", label: "Ledger" },
  { id: "roadmap", label: "Roadmap" },
  { id: "waitlist", label: "Waitlist" },
] as const;

export const NAV_SECTION_IDS = NAV_SECTIONS.map((section) => section.id);

export const MODEL_STAGES = [
  {
    title: "Admission",
    copy: "Per-agent token buckets and a bounded priority queue keep one loop from taking the whole lane.",
  },
  {
    title: "Scheduler",
    copy: "Wide changes run alone, narrow ones run in parallel per resource, and a waiting change is never overtaken by lower-priority work.",
  },
  {
    title: "Gate",
    copy: "A deny-overrides policy stack and a conflict check rule on every intent. Deferred changes wait on hold for a human.",
  },
  {
    title: "Ledger",
    copy: "Every verdict is appended to a hash chain so retroactive edits break verification.",
  },
];

export type Verdict = "admit" | "defer" | "reject";

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
export const LEDGER_HEAD_DIGEST = "189f5d55…0f84c3ca";

export const ROADMAP = [
  {
    version: "0.1",
    title: "The wall",
    copy: "Intent model, admission control, policy gate, ledger, and demo.",
  },
  {
    version: "0.2",
    title: "Scheduler",
    copy: "Wide changes serialize, narrow work runs in parallel per resource, and contradictions wait for a human.",
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

export const FOOTER_GROUPS: { title: string; links: Link[] }[] = [
  {
    title: "Explore",
    links: [
      { label: "Line", href: "#line" },
      { label: "Model", href: "#model" },
      { label: "Gate", href: "#gate" },
      { label: "Ledger", href: "#ledger" },
      { label: "Waitlist", href: "#waitlist" },
    ],
  },
  {
    title: "Crate",
    links: [
      { label: "Roadmap", href: "#roadmap" },
      { label: "Repository", href: REPO_URL },
      { label: "Goals", href: `${REPO_URL}/blob/main/GOALS.md` },
      { label: "Status", href: `${REPO_URL}/blob/main/STATUS.md` },
    ],
  },
  {
    title: "Related projects",
    links: [
      { label: "VMyard agent runtimes", href: "https://www.vmyard.com/" },
      { label: "knockstat server-log analytics", href: "https://www.knockstat.com/" },
      { label: "ERP•AI", href: "https://www.erp.ai/" },
    ],
  },
];

// A subdomain: www.proto.erp.ai only redirects back here.
export const PROTO_URL = "https://proto.erp.ai/";
