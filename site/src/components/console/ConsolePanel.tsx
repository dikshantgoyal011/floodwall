import { useId, type ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { monoLabel } from "../../styles/classes";

type ConsolePanelProps = {
  /** The panel's name, set in the landing page's mono label style in a ruled header band. */
  title?: string;
  /** A link or note at the header's trailing end. */
  action?: ReactNode;
  /** Rows and tables run edge to edge and pad themselves; otherwise the body takes the panel's inset. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * One sheet of the console: a white (in dark, raised gray) surface with the landing page's 1px rule
 * and square corners. Its header, when it has one, is a ruled band like the landing's evidence panels.
 * min-w-0 lets a wide table scroll inside it instead of widening the page.
 */
export function ConsolePanel({ title, action, flush, className, children }: ConsolePanelProps) {
  const titleId = useId();
  return (
    <section className={cx("min-w-0 border border-line bg-surface", className)} aria-labelledby={title ? titleId : undefined}>
      {title && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-2.5 console-narrow:px-4">
          <h2 id={titleId} className={monoLabel}>
            {title}
          </h2>
          {action && <div className="text-sm text-muted">{action}</div>}
        </header>
      )}
      <div className={flush ? undefined : "px-5 py-4 console-narrow:px-4"}>{children}</div>
    </section>
  );
}
