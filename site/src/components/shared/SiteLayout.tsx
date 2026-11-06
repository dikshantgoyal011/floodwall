import { Outlet } from "react-router";
import { useLandingLinks } from "../../hooks/useLandingLinks";
import { cx } from "../../helpers/cx";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The shell around the landing and pricing pages: the sticky header, the page and the footer.
 * `.fw-site` scopes the site styles (styles/site); `data-page="landing"` adds the landing page's
 * slide deck, and `data-light-only` keeps the pricing page, which has no dark theme, light.
 */
export function SiteLayout() {
  const { onLanding } = useLandingLinks();

  return (
    <div className="fw-site" data-page={onLanding ? "landing" : undefined} data-light-only={onLanding ? undefined : ""}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className={cx(!onLanding && "bg-[linear-gradient(180deg,var(--color-paper)_0%,#fff_48%,#f1f7fb_100%)]")}
      >
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
