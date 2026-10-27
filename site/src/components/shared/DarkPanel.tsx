import type { ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { cardReset } from "../../styles/classes";
import { Card } from "../ui/card";

type DarkPanelProps = {
  title: string;
  note: string;
  /** Show the note as a live status pill instead of plain text. */
  noteIsStatus?: boolean;
  footLabel: string;
  footCode: string;
  /** The panel's rows, usually a list styled with `panelRows`. */
  children: ReactNode;
};

/** The small uppercase text of a panel's head and foot bars. */
const BAR =
  "flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs font-bold tracking-[0.04em] text-panel-dim uppercase";

/**
 * Dark console-style card (Gate policies, Ledger records), on shadcn's Card:
 * a head bar over a stack of rows, on a faint grid, with a footer pinned to
 * the bottom so a panel stretched to its neighbour's height keeps its rows
 * packed at the top.
 */
export function DarkPanel({
  title,
  note,
  noteIsStatus = false,
  footLabel,
  footCode,
  children,
}: DarkPanelProps) {
  return (
    <Card
      className={cx(
        cardReset,
        "relative flex flex-col overflow-hidden rounded-(--radius-card) border border-line p-4 text-white shadow-card",
        "bg-[#0b1115] [background:var(--image-panel),#0b1115] *:relative",
        "before:absolute before:inset-0 before:bg-(image:--image-panel-grid) before:bg-size-[44px_44px] before:opacity-24",
      )}
    >
      <div className={cx(BAR, "border-b border-b-panel-line px-2 pt-2 pb-4")}>
        <span className="whitespace-nowrap">{title}</span>
        <span className={cx("whitespace-nowrap", noteIsStatus && "text-signal")}>{note}</span>
      </div>
      {children}
      <div className={cx(BAR, "mt-auto items-baseline border-t border-t-panel-line px-2 pt-4 pb-1")}>
        <span>{footLabel}</span>
        <code className="font-mono font-medium tracking-normal text-[rgba(255,255,255,0.84)] normal-case">
          {footCode}
        </code>
      </div>
    </Card>
  );
}
