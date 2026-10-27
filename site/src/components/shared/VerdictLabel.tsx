import { cx } from "../../helpers/cx";
import type { Verdict } from "../../types";
import { Badge } from "../ui/badge";

type VerdictLabelProps = { verdict: Verdict; variant: "badge" | "text" };

/** Each verdict's color, shared by the ledger's text labels and the gate's badges. */
const COLOR: Record<Verdict, string> = {
  admit: "[--verdict:var(--color-admit)]",
  defer: "[--verdict:var(--color-defer)]",
  reject: "[--verdict:var(--color-reject)]",
};

/** shadcn's Badge with its defaults undone: a plain block, no fixed size, clipping or text lock. */
const BADGE_RESET = "block h-auto w-auto gap-0 overflow-visible whitespace-normal";

const BADGE = cx(
  BADGE_RESET,
  "flex-none rounded-(--radius-pill) border px-2.5 py-0.5 text-xs leading-normal font-bold tracking-[0.04em] text-(--verdict) uppercase",
  "border-[color-mix(in_srgb,var(--verdict)_36%,transparent)] bg-[color-mix(in_srgb,var(--verdict)_14%,transparent)]",
);

/** A gate verdict colored by outcome, as a pill (shadcn's Badge) or plain text. */
export function VerdictLabel({ verdict, variant }: VerdictLabelProps) {
  if (variant === "badge") return <Badge className={cx(COLOR[verdict], BADGE)}>{verdict}</Badge>;
  return <span className={cx(COLOR[verdict], "font-bold text-(--verdict)")}>{verdict}</span>;
}
