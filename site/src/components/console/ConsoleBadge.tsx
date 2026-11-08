import { STATUS_TONE } from "../../constants/console";
import { cx } from "../../helpers/cx";
import { consoleTone } from "../../styles/classes";
import type { Verdict } from "../../types";
import type { IntentStatus } from "../../types/console";

/**
 * An intent status or gate verdict in the landing page's verdict type: Geist Mono, 11px, on its
 * tone's tint, square. The word carries the meaning; the color repeats it.
 */
export function ConsoleBadge({ value }: { value: IntentStatus | Verdict }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center px-2 font-mono text-[11px] leading-none font-medium whitespace-nowrap",
        consoleTone[STATUS_TONE[value]],
      )}
    >
      {value}
    </span>
  );
}
