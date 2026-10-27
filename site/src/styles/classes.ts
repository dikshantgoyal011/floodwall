// Tailwind class lists shared by more than one component. Each one styles a
// kind of element completely; components add their own layout around it.

/* ------------------------------------------------------------- Landing */

/** The centred content column, as wide as the content or the gutters allow. */
export const pageWidth = "mx-auto w-[min(var(--container-content),100%-2*var(--spacing-gutter))]";

/**
 * A landing section fills the space below the header and centres its
 * content, so a nav jump (which lands it under the header via the scroll
 * padding) leaves it in the middle of the view. Taller content just starts
 * at the top.
 */
export const landingSection = `${pageWidth} grid min-h-[calc(100svh-var(--spacing-header))] content-center py-section`;

/** The serif heading that opens a section or the footer. */
export const displayHeading = "font-display text-display-lg leading-none font-normal text-ink";

/** A bold text link that darkens on hover or focus. */
export const textLink =
  "font-bold text-ink-soft transition-[color] duration-180 ease-[ease] hover:text-black focus-visible:text-black";

// The landing page builds on shadcn's parts (components/ui) but keeps its own
// look, so each use undoes the shadcn defaults it does not share. Radii and
// card padding are written as var() classes: shadcn's class merge does not
// know the site's custom names (rounded-card, p-card) and would keep its own
// value beside them instead of replacing it.

/** Takes shadcn's Card back to a bare flex column: no gap, ring, clipping, padding or small text. */
export const cardReset = "gap-0 overflow-visible py-0 text-base ring-0";

/** The light bordered card, on shadcn's Card. */
export const card = `${cardReset} rounded-(--radius-card) border border-line bg-[rgba(255,255,255,0.78)]`;

export const cardTitle = "text-title leading-tight font-semibold text-ink";
export const cardCopy = "text-base leading-body text-muted";

/** A list item set off by a small bridge-red dot. */
export const bulletItem =
  "relative pl-5 text-base leading-body text-ink-soft before:absolute before:top-[0.62em] before:left-0 before:size-2 before:rounded-pill before:bg-bridge";

/** The list of rows on a dark panel, and each row's skin. */
export const panelRows = "mt-3 mb-4 grid gap-3";
export const panelRow = "rounded-row border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.07)] text-panel-text";

/** Line art in the bay scenes: unfilled, with round ends and joins. */
export const scenePath = "fill-none [stroke-linecap:round] [stroke-linejoin:round]";

/** The twinkling city lights along the bottom of the hero and footer scenes. */
export const bayLights =
  "absolute inset-x-[-4%] bottom-0 animate-twinkle bg-(image:--image-bay-lights) bg-size-[64px_34px,91px_42px,128px_50px] bg-position-[0_0,26px_13px,54px_22px] mask-[linear-gradient(180deg,transparent,#000_36%,transparent_100%)]";

/* ------------------------------------------------------------- Pricing */

/** A pricing section: the content column, spaced from the one above. */
export const pricingSection = `${pageWidth} pt-section`;

/* ------------------------------------------------------------- Console */

// Cards, buttons, inputs, selects, tables and tabs are shadcn's, in
// components/ui; these are the console's own pieces around them.

export const consoleLabel = "text-xs font-bold tracking-[0.04em] text-muted uppercase";
export const consoleMono = "font-mono text-[13px]";
export const consoleActions = "flex flex-wrap gap-2";

/** A divided list, its rows (plain or padded to the card's edges), and their parts. */
export const consoleList = "[&>li+li]:border-t [&>li+li]:border-t-line";
export const consoleRow = "flex items-center gap-4 py-3";
export const consoleRowPadded = "flex items-center gap-4 px-6 py-4";
export const consoleGrow = "min-w-0 flex-1";
export const consoleSub = "mt-1 block text-muted";

/** A labelled form field: the label above its input or select. */
export const consoleField = "flex flex-1 flex-col gap-2";

/** The background and text color of each status tone. */
export const consoleTone: Record<string, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-subtle text-ink-soft",
};
