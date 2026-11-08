import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DURATION = 900;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Lets the prerendered digits show again once a count has taken them over (see index.html). */
function releaseGate() {
  delete document.documentElement.dataset.countUp;
}

/**
 * Counts a whole number up from zero the first time it is in view. Anything
 * else (a version string, zero) renders as is. The prerendered HTML and
 * assistive technology carry the final value; reduced motion skips the count.
 */
export function CountUp({ value }: { value: string | number }) {
  const target = typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  const [counting, setCounting] = useState(false);

  // Before the hydrated page first paints, swap the prerendered final value for zero.
  useLayoutEffect(() => {
    if (target !== null && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(0);
      setCounting(true);
    }
    releaseGate();
  }, [target]);

  useEffect(() => {
    const element = ref.current;
    if (!counting || target === null || !element) return;
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / DURATION);
        setShown(Math.round(target * easeOut(progress)));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: .6 });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [counting, target]);

  return <>
    <span ref={ref} className="count-up" aria-hidden="true">{shown}</span>
    <span className="sr-only">{value}</span>
  </>;
}
