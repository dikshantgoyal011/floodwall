import { Outlet } from "react-router";
import { useScrollToHash } from "../../hooks/useScrollToHash";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** The shell around the landing and pricing pages: the sticky header, the page and the footer. */
export function SiteLayout() {
  useScrollToHash();

  return (
    <>
      <SiteHeader />
      <main className="bg-[linear-gradient(180deg,var(--color-paper)_0%,#fff_48%,#f1f7fb_100%)]">
        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}
