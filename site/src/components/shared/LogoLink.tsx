import type { ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { useLandingLinks } from "../../hooks/useLandingLinks";
import { BrandMark } from "./BrandMark";

type LogoLinkProps = { className?: string; children: ReactNode };

/** Brand mark and wordmark linking back to the top of the landing page. */
export function LogoLink({ className, children }: LogoLinkProps) {
  const { sectionHref } = useLandingLinks();

  return (
    <a
      className={cx(
        "inline-flex items-center gap-3 font-display text-2xl leading-none text-ink mobile:text-xl",
        className,
      )}
      href={sectionHref("#home")}
      aria-label="Floodwall home"
    >
      <BrandMark />
      <span>{children}</span>
    </a>
  );
}
