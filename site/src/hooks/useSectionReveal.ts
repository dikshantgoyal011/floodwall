import { useEffect } from "react";

/**
 * Each section's drawing rises into place the first time it enters view.
 * Only the inner drawing moves, so section geometry stays stable for
 * navigation. Reduced motion, or no IntersectionObserver, leaves content as is.
 */
export function useSectionReveal() {
  useEffect(() => {
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const drawings = [...document.querySelectorAll<HTMLElement>("main > .section .section-drawing")];
    let disposed = false;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.reveal = "done";
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -12% 0px" });
    const arm = () => {
      for (const drawing of drawings) {
        // Already visible at load (a fragment or reload mid-page): show without motion.
        const box = drawing.getBoundingClientRect();
        if (box.top < innerHeight && box.bottom > 0) continue;
        drawing.dataset.reveal = "pending";
        observer.observe(drawing);
      }
    };
    // Measure where the load lands: useSectionLinks jumps to a fragment or restores a reload's
    // position once fonts are ready, so wait for that and one frame before deciding what is visible.
    void document.fonts.ready.then(() => {
      if (!disposed) frame = requestAnimationFrame(arm);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      drawings.forEach(drawing => delete drawing.dataset.reveal);
    };
  }, []);
}
