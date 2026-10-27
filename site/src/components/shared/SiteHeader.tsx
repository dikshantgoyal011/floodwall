import { NAV_SECTIONS, NAV_SECTION_IDS, REPO_URL } from "../../constants/links";
import { cx } from "../../helpers/cx";
import { useActiveSection } from "../../hooks/useActiveSection";
import { useIsScrolled } from "../../hooks/useIsScrolled";
import { useLandingLinks } from "../../hooks/useLandingLinks";
import { pageWidth } from "../../styles/classes";
import { ButtonLink } from "./ButtonLink";
import { LogoLink } from "./LogoLink";

const NAV_LINK = "rounded-pill px-3 py-2 text-sm font-semibold transition-[color,background] duration-180 ease-[ease]";
/** The same shades at the top of the page and once the header turns solid. */
const NAV_LINK_IDLE =
  "text-muted hover:bg-tint-hover hover:text-ink focus-visible:bg-tint-hover focus-visible:text-ink";
const NAV_LINK_CURRENT = "bg-tint-active text-ink";

/** The sticky header on the landing and pricing pages, linking to the landing page's sections. */
export function SiteHeader() {
  const scrolled = useIsScrolled();
  const active = useActiveSection(NAV_SECTION_IDS);
  const { onLanding, sectionHref } = useLandingLinks();
  // Only the landing page has the sections, so elsewhere no link is current.
  const current = onLanding ? active : undefined;

  return (
    <header
      data-site-header
      data-scrolled={scrolled}
      className={cx(
        "sticky top-0 z-50 border-b border-b-transparent transition-[background,border-color,box-shadow] duration-200 ease-[ease]",
        "data-[scrolled=true]:border-b-line data-[scrolled=true]:bg-[rgba(247,251,255,0.82)] data-[scrolled=true]:shadow-[0_8px_32px_rgba(47,110,137,0.08)]",
        "data-[scrolled=true]:backdrop-blur-[16px] data-[scrolled=true]:backdrop-saturate-[1.4]",
      )}
    >
      <nav className={cx(pageWidth, "flex h-header items-center justify-between gap-6")} aria-label="Primary">
        <LogoLink>
          Floodwall<sup className="ml-0.5 font-body text-[10px] font-bold">&reg;</sup>
        </LogoLink>
        <div className="flex items-center gap-1 tablet:hidden">
          {NAV_SECTIONS.map(({ id, label }) => (
            <a
              key={id}
              className={cx(NAV_LINK, current === id ? NAV_LINK_CURRENT : NAV_LINK_IDLE)}
              href={sectionHref(`#${id}`)}
              aria-current={current === id ? "location" : undefined}
            >
              {label}
            </a>
          ))}
        </div>
        <ButtonLink href={REPO_URL} size="sm">
          View the Crate
        </ButtonLink>
      </nav>
    </header>
  );
}
