import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  FlowConnectionIcon,
  GithubIcon,
  Layers01Icon,
  Link04Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { NAV_EXPLAINERS, NAV_LINKS, NAV_SECTION_IDS, REPO_URL } from "../../constants/links";
import { useActiveSection } from "../../hooks/useActiveSection";
import { useFluidHover, useRegisterFluidHoverItem } from "../../hooks/use-fluid-hover";
import { spring } from "../../lib/springs";
import { FluidHoverHighlight } from "../fluid-hover-highlight";
import { Icon } from "./Icon";
import { SiteBrandMark } from "./SiteBrandMark";

const EXPLAINER_IDS: readonly string[] = NAV_EXPLAINERS.map(({ id }) => id);

/** Each explainer's icon in the "How it works" panel. */
const EXPLAINER_ICONS = {
  line: FlowConnectionIcon,
  model: Layers01Icon,
  gate: SecurityCheckIcon,
  ledger: Link04Icon,
} as const;

/**
 * The panel's entrance: it drops 4px into place and grows from 98% at its top edge. A spring, so a
 * close that interrupts an open reverses from where it is; the close is the tier's quicker tween.
 */
const PANEL_SHOWN = { opacity: 1, y: 0, scale: 1 };
const PANEL_HIDDEN = { opacity: 0, y: -4, scale: 0.98 };

type RegisterItem = (index: number, element: HTMLElement | null) => void;

/** A top-level item's hover box: the element the rubber-band highlight springs to. */
function NavItemBox({ index, registerItem, label }: { index: number; registerItem: RegisterItem; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <span className="nav-item" ref={ref}>
      <span className="nav-label">{label}</span>
    </span>
  );
}

/**
 * The sticky header on the landing page and /pricing: the logo (which goes home), a "How it works"
 * menu over the sections that explain the wall, then Roadmap, Pricing and Waitlist. One hover
 * highlight glides between the top-level items, and another between the panel's sections. On the
 * landing page the current item follows the section in view; /pricing (`onLanding` false) is the
 * only other page with this header, so there Pricing is current and section links lead to "/#…".
 */
export function SiteHeader({ onLanding = true }: { onLanding?: boolean }) {
  const tracked = useActiveSection(NAV_SECTION_IDS);
  const current: string = onLanding ? tracked : "pricing";
  const base = onLanding ? "" : "/";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // An outside press or Escape closes the menu; Escape hands focus back to its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);
  // Tabbing out of the menu closes it too.
  const onMenuBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
  };

  // The top-level strip: its items' hover boxes touch, so the highlight glides from one to the next.
  const linksRef = useRef<HTMLDivElement>(null);
  const navHover = useFluidHover(linksRef, { axis: "x" });
  const menuBoxRef = useNavBox(navHover.registerItem, 0);

  // The thick accent marks the item under the pointer while one is hovered, "How it works" while
  // its menu is open, and otherwise the current item. Hover indices follow the strip's order, the
  // same order as its labels.
  const accentIndex = navHover.activeIndex ?? (menuOpen ? 0 : null);
  const accentIndexRef = useRef(accentIndex);
  accentIndexRef.current = accentIndex;

  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPosition = useRef<{ x: number; y: number; width: number } | null>(null);
  const positionIndicator = useCallback((animate: boolean) => {
    const links = linksRef.current;
    const indicator = indicatorRef.current;
    if (!links || !indicator) return;
    // The accent runs along the bottom edge of the item's box (the header's), as wide as the box.
    const index = accentIndexRef.current;
    const box = index === null
      ? links.querySelector<HTMLElement>("[data-current] .nav-item")
      : links.querySelectorAll<HTMLElement>(".nav-item")[index] ?? null;
    if (!box) {
      // Nothing hovered or current (the hero, or between sections): no underline, and the next one
      // appears in place.
      indicator.style.visibility = "hidden";
      indicatorPosition.current = null;
      return;
    }
    const bar = links.getBoundingClientRect();
    const edge = box.getBoundingClientRect();
    // y lifts the line from the strip's foot to the box's bottom edge (and to its row when the links wrap).
    const next = { x: edge.left - bar.left, y: edge.bottom - bar.bottom, width: edge.width };
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

  useLayoutEffect(() => positionIndicator(true), [current, accentIndex, positionIndicator]);
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
    links.querySelectorAll(".nav-item").forEach(box => observer.observe(box));
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
        <div className="nav-links" ref={linksRef} {...navHover.handlers}>
          <FluidHoverHighlight hover={navHover} className="nav-hover" />
          <div className="nav-menu" ref={menuRef} onBlur={onMenuBlur}>
            <button
              ref={menuButtonRef}
              className="nav-menu-button"
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              data-current={EXPLAINER_IDS.includes(current) || undefined}
              onClick={() => setMenuOpen(open => !open)}
            >
              <span className="nav-item" ref={menuBoxRef}>
                <span className="nav-label">How it works</span>
                <Icon icon={ArrowDown01Icon} size={16} className="nav-menu-chevron" />
              </span>
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  className="nav-menu-panel"
                  id={menuId}
                  initial={PANEL_HIDDEN}
                  animate={PANEL_SHOWN}
                  exit={{ ...PANEL_HIDDEN, transition: spring.moderate.exit }}
                  transition={spring.moderate}
                >
                  <ExplainerGrid base={base} current={current} onChoose={() => setMenuOpen(false)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {NAV_LINKS.map(({ id, label, href }, index) => {
            const isCurrent = current === id;
            return (
              <a
                key={id}
                href={href.startsWith("#") ? `${base}${href}` : href}
                data-section={id}
                data-current={isCurrent || undefined}
                aria-current={isCurrent ? (id === "pricing" ? "page" : "location") : undefined}
              >
                <NavItemBox index={index + 1} registerItem={navHover.registerItem} label={label} />
              </a>
            );
          })}
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

/** Registers the menu button's hover box with the strip, returning the ref to put on it. */
function useNavBox(registerItem: RegisterItem, index: number): RefObject<HTMLSpanElement | null> {
  const ref = useRef<HTMLSpanElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return ref;
}

/**
 * The four sections as a 2×2 grid of ruled cells, each an icon tile, the section's name and its
 * heading. The cells touch, and `nearest` keeps one lit across the rules between them, so the
 * highlight glides from cell to cell.
 */
function ExplainerGrid({ base, current, onChoose }: { base: string; current: string; onChoose: () => void }) {
  const gridRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(gridRef, { axis: "xy", nearest: true });
  return (
    <ul className="nav-menu-grid" ref={gridRef} {...hover.handlers}>
      <FluidHoverHighlight hover={hover} className="nav-menu-hover" />
      {NAV_EXPLAINERS.map(({ id, label, copy }, index) => (
        <ExplainerCell
          key={id}
          index={index}
          registerItem={hover.registerItem}
          href={`${base}#${id}`}
          id={id}
          label={label}
          copy={copy}
          isCurrent={current === id}
          onChoose={onChoose}
        />
      ))}
    </ul>
  );
}

type ExplainerCellProps = {
  index: number;
  registerItem: RegisterItem;
  href: string;
  id: keyof typeof EXPLAINER_ICONS;
  label: string;
  copy: string;
  isCurrent: boolean;
  onChoose: () => void;
};

function ExplainerCell({ index, registerItem, href, id, label, copy, isCurrent, onChoose }: ExplainerCellProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <li>
      <a ref={ref} href={href} data-section={id} aria-current={isCurrent ? "location" : undefined} onClick={onChoose}>
        <span className="nav-menu-icon">
          <Icon icon={EXPLAINER_ICONS[id]} size={22} />
        </span>
        <span className="nav-menu-text">
          <span className="nav-menu-label">{label}</span>
          <span className="nav-menu-copy">{copy}</span>
        </span>
      </a>
    </li>
  );
}
