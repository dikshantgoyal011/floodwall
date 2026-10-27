import { useEffect, useState } from "react";
import { headerHeight } from "../helpers/dom";

/**
 * The id of the section crossing the middle of the space below the site
 * header. Sections fill that space, so a nav jump always puts its target
 * there. If two ever share it, the earlier one in `ids` wins. `ids` must be
 * stable.
 */
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const crossing = new Set<string>();
    let observer: IntersectionObserver | undefined;
    let frame = 0;

    const onIntersect = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.isIntersecting) crossing.add(entry.target.id);
        else crossing.delete(entry.target.id);
      }
      const first = ids.find((id) => crossing.has(id));
      if (first) setActive(first);
    };

    // Watch a 1px line through that middle. The margins are pixels because
    // the spec resolves rootMargin percentages against the root's width,
    // even for top and bottom, so they depend on viewport and header size
    // and are rebuilt whenever the window changes size.
    const observe = () => {
      observer?.disconnect();
      crossing.clear();
      const header = headerHeight();
      const line = Math.round(header + (window.innerHeight - header) / 2);
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
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(observe);
    };

    observe();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [ids]);

  return active;
}
