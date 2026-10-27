export type Link = { label: string; href: string };

export type Verdict = "admit" | "defer" | "reject";

/** One <path> of an SVG illustration, with its own classes if it differs from its siblings. */
export type SvgPath = { d: string; className?: string };
