import type { Link } from "../types";

export const REPO_URL = "https://github.com/erphq/floodwall";

export const PRICING_PATH = "/pricing";

/** Hosted plans open by invitation: requests go to the team's waitlist form. */
export const EARLY_ACCESS_URL = "https://tally.so/r/6DJeoP";

// A subdomain: www.proto.erp.ai only redirects back here.
export const PROTO_URL = "https://proto.erp.ai/";

/**
 * The landing page's sections that explain the wall, grouped in the header under one menu. Each
 * describes itself with its own section heading.
 */
export const NAV_EXPLAINERS = [
  { id: "line", label: "Line", copy: "Every intent gets a verdict." },
  { id: "model", label: "Model", copy: "Agents submit intents. Floodwall governs." },
  { id: "gate", label: "Gate", copy: "Many policies. One verdict." },
  { id: "ledger", label: "Ledger", copy: "Chained records. Independent proof." },
] as const;

/** The header's top-level links after that menu: two landing sections and the pricing page. */
export const NAV_LINKS = [
  { id: "roadmap", label: "Roadmap", href: "#roadmap" },
  { id: "pricing", label: "Pricing", href: PRICING_PATH },
  { id: "waitlist", label: "Waitlist", href: "#waitlist" },
] as const;

/** Every landing section the header tracks, in page order; Home is the logo's. */
export const NAV_SECTION_IDS = ["home", "line", "model", "gate", "ledger", "roadmap", "waitlist"] as const;

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
