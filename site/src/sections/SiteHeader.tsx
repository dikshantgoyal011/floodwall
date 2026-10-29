import { useCallback, useLayoutEffect, useRef } from "react";
import { NAV_SECTIONS, NAV_SECTION_IDS, REPO_URL } from "../content";
import { useActiveSection } from "../hooks";
import { BrandMark } from "../components/BrandMark";
import { ArrowUpRight01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { Icon } from "../components/Icon";

export function SiteHeader() {
  const active = useActiveSection(NAV_SECTION_IDS);
  const linksRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPosition = useRef<{ x: number; width: number } | null>(null);
  const positionIndicator = useCallback((animate: boolean) => {
    const links = linksRef.current;
    const indicator = indicatorRef.current;
    const label = links?.querySelector<HTMLElement>('a[aria-current] > span');
    if (!links || !indicator || !label) return;
    const bar = links.getBoundingClientRect();
    const text = label.getBoundingClientRect();
    const next = { x: text.left - bar.left, width: text.width };
    const previous = indicatorPosition.current;
    if (previous && Math.abs(previous.x - next.x) < .1 && Math.abs(previous.width - next.width) < .1) return;
    if (!previous || !animate) indicator.style.transition = "none";
    indicator.style.transform = `translateX(${next.x}px) scaleX(${next.width})`;
    indicator.style.visibility = "visible";
    if (!previous || !animate) {
      // Commit initial/font/viewport alignment without a sweep from the old layout.
      indicator.getBoundingClientRect();
      indicator.style.removeProperty("transition");
    }
    indicatorPosition.current = next;
  }, []);

  useLayoutEffect(() => positionIndicator(true), [active, positionIndicator]);
  useLayoutEffect(() => {
    const links = linksRef.current;
    if (!links) return;
    const observer = new ResizeObserver(() => positionIndicator(false));
    observer.observe(links);
    links.querySelectorAll("a > span").forEach(label => observer.observe(label));
    return () => observer.disconnect();
  }, [positionIndicator]);

  return (
    <header className="site-header">
      <nav className="nav-bar page-width" aria-label="Primary">
        <a className="logo" href="#home" aria-label="Floodwall home">
          <BrandMark />
          <span>
            Floodwall<sup>&reg;</sup>
          </span>
        </a>
        <div className="nav-links" ref={linksRef}>
          {NAV_SECTIONS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} data-section={id} aria-current={active === id ? "location" : undefined}>
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
