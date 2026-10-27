import { Badge } from "../ui/badge";
import { STATUS_TONE } from "../../constants/console";
import { cx } from "../../helpers/cx";
import { consoleTone } from "../../styles/classes";
import type { Verdict } from "../../types";
import type { IntentStatus } from "../../types/console";

/** An intent status or gate verdict as shadcn's Badge, colored by tone; a size up from shadcn's 20px. */
export function ConsoleBadge({ value }: { value: IntentStatus | Verdict }) {
  return <Badge className={cx("h-6 px-2.5", consoleTone[STATUS_TONE[value]])}>{value}</Badge>;
}
