import type { Link } from "../types";

export const REPO_URL = "https://github.com/erphq/floodwall";

// A subdomain: www.proto.erp.ai only redirects back here.
export const PROTO_URL = "https://proto.erp.ai/";

/** In-page sections the primary nav links to, in page order. */
export const NAV_SECTIONS = [
  { id: "home", label: "Home" },
  { id: "model", label: "Model" },
  { id: "gate", label: "Gate" },
  { id: "ledger", label: "Ledger" },
  { id: "roadmap", label: "Roadmap" },
] as const;

export const NAV_SECTION_IDS = NAV_SECTIONS.map((section) => section.id);

export const FOOTER_GROUPS: { title: string; links: Link[] }[] = [
  {
    title: "Explore",
    links: [
      { label: "Model", href: "#model" },
      { label: "Gate", href: "#gate" },
      { label: "Ledger", href: "#ledger" },
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
      { label: "ERP.AI", href: "https://www.erp.ai/" },
    ],
  },
];
