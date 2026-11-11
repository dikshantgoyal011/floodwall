import { useEffect, useState } from "react";
import { headerHeight, SECTION_NAVIGATION_EVENT } from "../helpers/dom";

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
