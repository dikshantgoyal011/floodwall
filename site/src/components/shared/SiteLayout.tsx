import { Outlet } from "react-router";
import { useScrollToHash } from "../../hooks/useScrollToHash";
import { useSiteDocument } from "../../hooks/useSiteDocument";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** The shell around /pricing: the landing page's header, deck and footer, in its light and dark themes. */
export function SiteLayout() {
  useScrollToHash();
  useSiteDocument();

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader onLanding={false} />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter onLanding={false} />
    </>
  );
}
