import type { ReactNode } from "react";
import { monoLabel } from "../../styles/classes";

type ConsoleStatsProps = { stats: { label: string; value: ReactNode; hint?: string }[]; label: string };

/**
 * Figures in one ruled strip, the landing diagram's title block: cells divided by 1px rules, each a
 * mono label over a tabular mono figure, its hint beneath. Four across, two on narrow screens.
 */
export function ConsoleStats({ stats, label }: ConsoleStatsProps) {
  return (
    <dl
      aria-label={label}
      className="grid grid-cols-4 gap-px border border-line bg-line console-narrow:grid-cols-2"
    >
      {stats.map(({ label: name, value, hint }) => (
        <div key={name} className="flex min-w-0 flex-col gap-2 bg-surface px-5 py-4 console-narrow:px-4">
          <dt className={monoLabel}>{name}</dt>
          <dd className="font-mono text-[28px] leading-none font-[450] tracking-[-0.03em] text-ink tabular-nums slashed-zero">
            {value}
          </dd>
          {hint && <dd className="text-sm leading-snug text-muted">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
