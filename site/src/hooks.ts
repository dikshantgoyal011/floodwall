import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const SECTION_NAVIGATION_EVENT = "floodwall:section-navigation";

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/**
 * Background video plays only on tablet-width screens and up, and never for
 * visitors who prefer reduced motion or have Save-Data turned on.
 */
export function useVideoEligibility() {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const tablet = useMediaQuery("(min-width: 760px)");
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  return !reducedMotion && tablet && !saveData;
}

/** True once the page has scrolled away from the very top. */
export function useIsScrolled() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return scrolled;
}

function headerHeight() {
  return document.querySelector<HTMLElement>(".site-header")?.offsetHeight ?? 0;
}

/** The element id a URL fragment names, or "" if it is empty or malformed (e.g. "#%"). */
function fragmentId(fragment: string) {
  try {
    return decodeURIComponent(fragment.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/**
 * The id of the section crossing the bottom edge of the sticky site
 * header, where section links land their surface. If two
 * ever share it, the earlier one in `ids` wins. `ids` must be stable.
 */
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const crossing = new Set<string>();
    let observer: IntersectionObserver | undefined;
    let frame = 0;
    let destination: string | null = null;

    const followSection = () => {
      const first = ids.find((id) => crossing.has(id));
      if (!first || (destination && first !== destination)) return;
      destination = null;
      setActive(first);
    };

    const onIntersect = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.isIntersecting) crossing.add(entry.target.id);
        else crossing.delete(entry.target.id);
      }
      followSection();
    };

    const onNavigate = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!ids.includes(event.detail)) {
        destination = null;
        followSection();
        return;
      }
      // Commit the clicked destination while intermediate sections pass the observer.
      destination = crossing.has(event.detail) ? null : event.detail;
      setActive(event.detail);
    };
    const resumeTracking = () => {
      destination = null;
      followSection();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href^="#"]')) resumeTracking();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) resumeTracking();
    };

    // Watch a 1px line immediately below the sticky header. The margins are pixels because
    // the spec resolves rootMargin percentages against the root's width,
    // even for top and bottom, so they depend on viewport and header size
    // and are rebuilt whenever the window changes size.
    const observe = () => {
      observer?.disconnect();
      crossing.clear();
      const line = headerHeight();
      const below = window.innerHeight - line - 1;
      observer = new IntersectionObserver(onIntersect, {
        rootMargin: `${-line}px 0px ${-below}px 0px`,
      });
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element) observer.observe(element);
      }
    };

    const onResize = () => {
      destination = null;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(observe);
    };

    observe();
    document.addEventListener(SECTION_NAVIGATION_EVENT, onNavigate);
    window.addEventListener("wheel", resumeTracking, { passive: true });
    window.addEventListener("touchstart", resumeTracking, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener(SECTION_NAVIGATION_EVENT, onNavigate);
      window.removeEventListener("wheel", resumeTracking);
      window.removeEventListener("touchstart", resumeTracking);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [ids]);

  return active;
}

/**
 * Align each section surface flush below the sticky navigation.
 * Also aligns a section named in the URL on first load; a
 * malformed or unknown fragment is ignored.
 */
export function useCenteredSectionLinks() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let disposed = false;
    const positionKey = "floodwallScrollEntry";
    // Track scrolls in memory; history state only carries an entry id, never per-frame writes.
    const positions = new Map<string, number>();
    let entry: string = crypto.randomUUID();
    let traversedUrl: string | null = null;
    const markEntry = () => history.replaceState({ ...history.state, [positionKey]: entry }, "");
    const rememberPosition = () => positions.set(entry, window.scrollY);
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
    if (initial) void document.fonts.ready.then(() => {
      if (!disposed && fragmentId(location.hash) === initial) scrollToSection(initial, "instant");
    });
    const onPopState = () => {
      rememberPosition();
      traversedUrl = location.href;
      const restoredEntry: unknown = history.state?.[positionKey];
      entry = typeof restoredEntry === "string" ? restoredEntry : crypto.randomUUID();
      const top = positions.get(entry);
      if (top !== undefined) {
        window.scrollTo({ top, behavior: "instant" });
        document.dispatchEvent(new CustomEvent(SECTION_NAVIGATION_EVENT, { detail: "" }));
      } else {
        markEntry();
        scrollToSection(fragmentId(location.hash) || "home", "instant");
      }
      rememberPosition();
    };
    const onHashChange = () => {
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
    return () => {
      disposed = true;
      history.scrollRestoration = previousRestoration;
      document.removeEventListener("click", onClick);
      window.removeEventListener("scroll", rememberPosition);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
}
