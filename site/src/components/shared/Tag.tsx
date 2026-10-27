import type { ReactElement } from "react";
import { cx } from "../../helpers/cx";
import { Badge } from "../ui/badge";

type TagProps = {
  /** The element to render, such as <h3 />; a <span> by default. */
  render?: ReactElement;
  children: string;
};

/** shadcn's Badge with its defaults undone: no fixed height, border, clipping or centring. */
const BADGE_RESET = "h-auto w-auto shrink gap-0 overflow-visible justify-normal border-0 whitespace-normal";

/** Small uppercase pill set above a card's title: shadcn's Badge in the site's colors. */
export function Tag({ render, children }: TagProps) {
  return (
    <Badge
      render={render}
      className={cx(
        BADGE_RESET,
        "self-start rounded-(--radius-pill) bg-[rgba(232,109,78,0.1)] px-3 py-1.5 text-xs leading-normal font-bold tracking-[0.04em] text-bridge uppercase",
      )}
    >
      {children}
    </Badge>
  );
}
