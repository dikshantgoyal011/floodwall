import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a `position: sticky` element is pinned at its `top` offset. The element is observed against
 * the viewport shrunk by one pixel past that offset: pinned, its top edge sits in the cut-off pixel and
 * it is no longer fully visible. An element below the fold is not fully visible either, so the edge's
 * position decides between the two.
 */
export function useStuck(ref: RefObject<HTMLElement | null>) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const top = parseFloat(getComputedStyle(element).top) || 0;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(entry.intersectionRatio < 1 && entry.boundingClientRect.top <= top + 1),
      { rootMargin: `${-(top + 1)}px 0px 0px 0px`, threshold: 1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return stuck;
}
