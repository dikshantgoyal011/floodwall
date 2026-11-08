import { useCallback, useLayoutEffect, useRef } from "react";
import { NAV_SECTIONS, NAV_SECTION_IDS, REPO_URL } from "../../constants/links";
import { useActiveSection } from "../../hooks/useActiveSection";
import { SiteBrandMark } from "./SiteBrandMark";
import { ArrowUpRight01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

/**
 * The sticky header on the landing page and /pricing. Off the landing page (`onLanding` false) its
 * section links lead to "/#…" and none is current, since only the landing page has the sections.
 */
export function SiteHeader({ onLanding = true }: { onLanding?: boolean }) {
  const tracked = useActiveSection(NAV_SECTION_IDS);
  const active = onLanding ? tracked : undefined;
  const base = onLanding ? "" : "/";
  const linksRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPosition = useRef<{ x: number; y: number; width: number } | null>(null);
  const positionIndicator = useCallback((animate: boolean) => {
    const links = linksRef.current;
    const indicator = indicatorRef.current;
    const label = links?.querySelector<HTMLElement>('a[aria-current] > span');
    if (!links || !indicator || !label) return;
    const bar = links.getBoundingClientRect();
    const text = label.getBoundingClientRect();
    // y lifts the line to its label's row when the links wrap; it is 0 on a single row.
    const row = label.closest("a")!.getBoundingClientRect();
    const next = { x: text.left - bar.left, y: row.bottom - bar.bottom, width: text.width };
    const previous = indicatorPosition.current;
    if (previous && Math.abs(previous.x - next.x) < .1 && Math.abs(previous.y - next.y) < .1
      && Math.abs(previous.width - next.width) < .1) return;
    if (!previous || !animate) indicator.style.transition = "none";
    indicator.style.transform = `translate(${next.x}px, ${next.y}px) scaleX(${next.width})`;
    indicator.style.visibility = "visible";
    if (!previous || !animate) {
      // Commit initial/font/viewport alignment without a sweep from the old layout.
      indicator.getBoundingClientRect();
      indicator.style.removeProperty("transition");
    }
    indicatorPosition.current = next;
  }, []);

  useLayoutEffect(() => positionIndicator(true), [active, positionIndicator]);
  // Publish the header's real height for scroll offsets and the slide height; it grows when the links wrap.
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--header-offset", `${header.offsetHeight}px`));
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-offset");
    };
  }, []);
  useLayoutEffect(() => {
    const links = linksRef.current;
    if (!links) return;
    const observer = new ResizeObserver(() => positionIndicator(false));
    observer.observe(links);
    links.querySelectorAll("a > span").forEach(label => observer.observe(label));
    return () => observer.disconnect();
  }, [positionIndicator]);

  return (
    <header className="site-header" ref={headerRef}>
      <nav className="nav-bar page-width" aria-label="Primary">
        <a className="logo" href={`${base}#home`} aria-label="Floodwall home">
          <SiteBrandMark />
          <span>
            Floodwall<sup>&reg;</sup>
          </span>
        </a>
        <div className="nav-links" ref={linksRef}>
          {NAV_SECTIONS.map(({ id, label }) => (
            <a key={id} href={`${base}#${id}`} data-section={id} aria-current={active === id ? "location" : undefined}>
              <span>{label}</span>
            </a>
          ))}
          <span className="nav-indicator" ref={indicatorRef} aria-hidden="true" />
        </div>
        <a className="button button-sm" href={REPO_URL}>
          <Icon icon={GithubIcon} size={16} className="button-brand" />
          View the Crate
          <Icon icon={ArrowUpRight01Icon} size={16} className="button-arrow" />
        </a>
      </nav>
    </header>
  );
}
