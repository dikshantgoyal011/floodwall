import { cx } from "../../helpers/cx";
import { Button } from "../ui/button";

type ButtonLinkProps = { href: string; size: "sm" | "lg"; children: string };

const SIZE = {
  sm: "min-h-10 px-5 text-sm mobile:min-h-9 mobile:px-4",
  lg: "min-h-14 px-12 text-base",
};

/**
 * shadcn's Button with its defaults undone: no fixed height, border, gap,
 * pressed nudge or text lock, and the site's focus outline in place of its
 * ring (its outline-none would otherwise hide the outline).
 */
const BUTTON_RESET = cx(
  "h-auto shrink gap-0 border-0 bg-clip-border select-auto active:not-aria-[haspopup]:translate-y-0",
  "focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-bay-deep",
);

/** A link styled as the solid call-to-action button, on shadcn's Button. */
export function ButtonLink({ href, size, children }: ButtonLinkProps) {
  return (
    <Button
      nativeButton={false}
      render={<a href={href} />}
      className={cx(
        BUTTON_RESET,
        "rounded-(--radius-pill) bg-black font-bold text-white",
        "transition-[transform,background] duration-180 ease-[ease]",
        "hover:transform-[scale(1.03)] hover:bg-[#151515] focus-visible:transform-[scale(1.03)] focus-visible:bg-[#151515]",
        SIZE[size],
      )}
    >
      {children}
    </Button>
  );
}
