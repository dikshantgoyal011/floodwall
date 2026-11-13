import type { Link } from "../types";

export const REPO_URL = "https://github.com/erphq/floodwall";

export const PRICING_PATH = "/pricing";

/**
 * Where every "Get started" goes: /signup (AUTH_PATHS.signup) makes a free account that opens the
 * console. Sign-up is open; were the service's SIGNUP_MODE set back to "waitlist", a new account
 * would wait for an admin instead. A plain path, not a router link: the landing page is prerendered
 * without the router.
 */
export const EARLY_ACCESS_URL = "/signup";

// Requests went to the team's form on Tally before the site had its own waitlist. To go back to it,
// restore this URL, link index.html's noscript note to %EARLY_ACCESS_URL% again, and put back the
// check and fill-in for it in vite.config.ts's structured-data plugin (removed in c5ea719).
// export const EARLY_ACCESS_URL = "https://tally.so/r/6DJeoP";

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
  { id: "get-started", label: "Sign up", href: "#get-started" },
] as const;

/** Every landing section the header tracks, in page order; Home is the logo's. */
export const NAV_SECTION_IDS = ["home", "line", "model", "gate", "ledger", "roadmap", "get-started"] as const;

export const FOOTER_GROUPS: { title: string; links: Link[] }[] = [
  {
    title: "Explore",
    links: [
      { label: "Line", href: "#line" },
      { label: "Model", href: "#model" },
      { label: "Gate", href: "#gate" },
      { label: "Ledger", href: "#ledger" },
      { label: "Get started", href: "#get-started" },
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
