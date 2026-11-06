import { useEffect } from "react";
import { fragmentId, headerHeight, SECTION_NAVIGATION_EVENT } from "../helpers/dom";

const POSITIONS_KEY = "floodwall:scroll-positions";
const POSITIONS_LIMIT = 50;
/** How long a restored position is held against late layout before scrolling is the reader's again. */
const RESTORE_SETTLE_MS = 2000;

/**
 * A scroll position held against the section at the top of the view, so it survives content
 * above that section changing height (the hero diagram sizing itself, the waitlist form growing).
 */
type ScrollPosition = { section: string; offset: number };

/** The section crossing the header line, and how far the view has scrolled into it. */
function currentPosition(): ScrollPosition {
  const line = headerHeight();
  const sections = [...document.querySelectorAll<HTMLElement>("main > section[id]")];
  const section = sections.filter((element) => element.getBoundingClientRect().top <= line + 1).at(-1) ?? sections[0];
  if (!section) return { section: "", offset: window.scrollY };
  return { section: section.id, offset: line - section.getBoundingClientRect().top };
}

/** The scroll offset that puts a saved position back under the header line. */
function scrollTopFor({ section, offset }: ScrollPosition) {
  const element = section ? document.getElementById(section) : null;
  if (!element) return offset;
  return window.scrollY + element.getBoundingClientRect().top - headerHeight() + offset;
}

const isPosition = (value: unknown): value is ScrollPosition =>
  !!value && typeof value === "object" && typeof (value as ScrollPosition).section === "string"
  && Number.isFinite((value as ScrollPosition).offset);

/** Scroll positions by history entry id, kept for the tab's session so they survive a reload. */
function loadPositions() {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(POSITIONS_KEY) ?? "{}");
    if (saved && typeof saved === "object") {
      return new Map(Object.entries(saved).filter((pair): pair is [string, ScrollPosition] => isPosition(pair[1])));
    }
  } catch { /* Storage blocked or corrupt: positions last for this page only. */ }
  return new Map<string, ScrollPosition>();
}

function savePositions(positions: Map<string, ScrollPosition>) {
  // Keep the most recently used entries; a long session never grows the store without bound.
  const recent = [...positions].slice(-POSITIONS_LIMIT);
  try { sessionStorage.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(recent))); } catch { /* Optional. */ }
}

/** How this document was reached: "reload" and "back_forward" bring their history entry back. */
function navigationType() {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type ?? "navigate";
}

/**
 * Align each section surface flush below the sticky navigation.
 * Also aligns a section named in the URL on first load; a
 * malformed or unknown fragment is ignored. A reload, or returning to
 * the page through history, restores the exact position its entry had.
 */
export function useSectionLinks() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let disposed = false;
    const positionKey = "floodwallScrollEntry";
    // Track scrolls in memory and persist them when the page is hidden or left; history state only
    // carries an entry id, never per-frame writes.
    const positions = loadPositions();
    const savedEntry: unknown = history.state?.[positionKey];
    let entry: string = typeof savedEntry === "string" ? savedEntry : crypto.randomUUID();
    const restored = navigationType() === "navigate" ? undefined : positions.get(entry);
    // Until a restoring load has scrolled back, the top of the page is not a position worth saving.
    let restoring = restored !== undefined;
    let traversedUrl: string | null = null;
    const markEntry = () => history.replaceState({ ...history.state, [positionKey]: entry }, "");
    const rememberPosition = () => {
      if (restoring) return;
      positions.delete(entry);
      positions.set(entry, currentPosition());
    };
    const persist = () => {
      rememberPosition();
      savePositions(positions);
    };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") persist(); };
    markEntry();
    rememberPosition();

    const scrollToSection = (id: string, behavior: ScrollBehavior) => {
      const target = id ? document.getElementById(id) : null;
      if (!target) return false;

      const header = headerHeight();
      const { top } = target.getBoundingClientRect();

      document.dispatchEvent(new CustomEvent(SECTION_NAVIGATION_EVENT, { detail: id }));
      window.scrollTo({ top: window.scrollY + top - header, behavior });

      // Move keyboard focus along with the view, as a native jump would.
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      return true;
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
      const id = fragmentId(link?.getAttribute("href") ?? "");
      if (!id || !document.getElementById(id)) return;

      event.preventDefault();
      releaseRestore();
      traversedUrl = null;
      // Capture before moving, including instant jumps and interrupted smooth scrolling.
      rememberPosition();
      if (location.hash !== `#${id}`) {
        entry = crypto.randomUUID();
        history.pushState({ [positionKey]: entry }, "", `#${id}`);
      }
      scrollToSection(id, reducedMotion.matches ? "auto" : "smooth");
    };

    const initial = fragmentId(location.hash);
    // A restoring load holds its position while late layout lands (the diagram sizing itself, the
    // waitlist form resizing), until it settles or the reader moves; a link, history step or hash
    // change made meanwhile wins over the restore.
    let stopRestore = () => {};
    let releaseRestore = () => {};
    if (restored !== undefined) {
      let layout: ResizeObserver | undefined;
      let timer: number | undefined;
      const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
      stopRestore = () => {
        layout?.disconnect();
        window.clearTimeout(timer);
        inputs.forEach((type) => window.removeEventListener(type, releaseRestore));
      };
      releaseRestore = () => {
        stopRestore();
        if (!restoring) return;
        restoring = false;
        rememberPosition();
      };
      // Input wins even while fonts are pending, before the restore observer exists.
      inputs.forEach((type) => window.addEventListener(type, releaseRestore, { passive: true }));
      void document.fonts.ready.then(() => {
        if (disposed || !restoring) return;
        const hold = () => {
          if (!restoring) return;
          window.scrollTo({ top: scrollTopFor(restored), behavior: "instant" });
          document.dispatchEvent(new CustomEvent(SECTION_NAVIGATION_EVENT, { detail: "" }));
        };
        layout = new ResizeObserver(hold);
        timer = window.setTimeout(releaseRestore, RESTORE_SETTLE_MS);
        hold();
        layout.observe(document.body);
      });
    }
    else if (initial) void document.fonts.ready.then(() => {
      if (!disposed && fragmentId(location.hash) === initial) scrollToSection(initial, "instant");
    });
    const onPopState = () => {
      releaseRestore();
      rememberPosition();
      traversedUrl = location.href;
      const restoredEntry: unknown = history.state?.[positionKey];
      entry = typeof restoredEntry === "string" ? restoredEntry : crypto.randomUUID();
      const position = positions.get(entry);
      if (position !== undefined) {
        window.scrollTo({ top: scrollTopFor(position), behavior: "instant" });
        document.dispatchEvent(new CustomEvent(SECTION_NAVIGATION_EVENT, { detail: "" }));
      } else {
        markEntry();
        scrollToSection(fragmentId(location.hash) || "home", "instant");
      }
      rememberPosition();
    };
    const onHashChange = () => {
      releaseRestore();
      const traversed = traversedUrl === location.href;
      traversedUrl = null;
      if (!traversed) {
        rememberPosition();
        entry = crypto.randomUUID();
        markEntry();
        scrollToSection(fragmentId(location.hash), "instant");
        rememberPosition();
      }
    };
    document.addEventListener("click", onClick);
    window.addEventListener("scroll", rememberPosition, { passive: true });
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      stopRestore();
      persist();
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      history.scrollRestoration = previousRestoration;
      document.removeEventListener("click", onClick);
      window.removeEventListener("scroll", rememberPosition);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
}
