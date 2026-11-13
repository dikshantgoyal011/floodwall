// Tailwind class lists shared by more than one component. Each one styles a
// kind of element completely; components add their own layout around it.

/* ------------------------------------------------------------- Sign-in */

/** The centred column the sign-in, sign-up and account sheets sit in. */
export const pageWidth = "mx-auto w-[min(var(--container-content),100%-2*var(--spacing-gutter))]";

/** A white sheet with the landing page's 1px rule and square corners, on shadcn's Card. */
export const card = "gap-0 overflow-visible rounded-none border border-line bg-surface py-0 text-base ring-0";

// Passed straight to shadcn's Button: the landing page's square buttons. They undo
// its fixed height, border and pressed nudge, and use the site's focus outline.
const buttonBase =
  "h-auto min-h-11 shrink gap-3 rounded-none px-5 text-sm font-medium transition-[background,border-color] duration-160 ease-[cubic-bezier(.25,1,.5,1)] active:not-aria-[haspopup]:translate-y-0 focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink disabled:opacity-55";

/** The solid near-black button, as a form button. */
export const pillSolid = `${buttonBase} border border-transparent bg-action text-action-text hover:bg-action-hover`;

/** The outlined button beside it, for the quieter actions. */
export const pillOutline = `${buttonBase} border border-line-strong bg-surface text-ink hover:border-ink hover:bg-surface`;

/** The sign-in form or account details: one row of the sign-in sheet, so it adds no frame of its own. */
export const authCard = "gap-5 rounded-none border-0 bg-transparent py-0 text-base text-ink ring-0";

/** The note that says the code is a demo: a ruled band, neutral, since it is not an outcome. */
export const authNote = "border border-line bg-subtle px-4 py-3 font-mono text-xs leading-normal text-ink";

/** The landing page's mono label: section tabs, panel headers and field captions. */
export const monoLabel = "font-mono text-[11px] font-medium tracking-[0.08em] text-muted uppercase";

/* ------------------------------------------------------------- Console */

// Cards, buttons, inputs, selects, tables and tabs are shadcn's, in
// components/ui; these are the console's own pieces around them.

export const consoleLabel = monoLabel;
export const consoleMono = "font-mono text-[13px] tabular-nums";
export const consoleActions = "flex flex-wrap gap-2";

/**
 * A divided list in a flush ConsolePanel, its rows running edge to edge with the panel's inset, and
 * their parts. A row with a second line (consoleSub) keeps the same rhythm.
 */
export const consoleList = "[&>li+li]:border-t [&>li+li]:border-t-line";
export const consoleRow = "flex min-h-12 items-center gap-4 px-5 py-3 console-narrow:gap-3 console-narrow:px-4";
export const consoleGrow = "min-w-0 flex-1 leading-normal";
export const consoleSub = "mt-0.5 block text-[13px] leading-normal text-muted";

/** A link inside console content: ink, underlined on hover, the landing page's link treatment. */
export const consoleLink = "font-medium text-ink underline-offset-4 decoration-line-strong hover:underline";

/** A table column (header and cells) that only wide screens show; the intent's page has its value. */
export const consoleWideOnly = "console-narrow:hidden";

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
