import { cx } from "../../helpers/cx";
import { Button } from "../ui/button";

type ButtonLinkProps = { href: string; size: "sm" | "lg"; children: string };

const SIZE = {
  sm: "min-h-11 px-5 text-sm",
  lg: "min-h-13 px-6 text-sm",
};

/**
 * shadcn's Button with its defaults undone: no fixed height, border, gap,
 * pressed nudge or text lock, and the site's focus outline in place of its
 * ring (its outline-none would otherwise hide the outline).
 */
const BUTTON_RESET = cx(
  "h-auto shrink gap-0 border-0 bg-clip-border select-auto active:not-aria-[haspopup]:translate-y-0",
  "focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink",
);

/** A link styled as the landing page's square near-black button, on shadcn's Button. */
export function ButtonLink({ href, size, children }: ButtonLinkProps) {
  return (
    <Button
      nativeButton={false}
      render={<a href={href} />}
      className={cx(
        BUTTON_RESET,
        "rounded-none bg-ink font-medium text-white",
        "transition-[background] duration-160 ease-[cubic-bezier(.25,1,.5,1)]",
        "hover:bg-[#353535] active:bg-black",
        SIZE[size],
      )}
    >
      {children}
    </Button>
  );
}
