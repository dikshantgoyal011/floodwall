import { useEffect, useRef, useState } from "react";

const DURATION = 900;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Counts a whole number up from zero the first time it enters view. Anything
 * else (a version string, zero) renders as is. Assistive technology reads
 * only the final value; reduced motion skips the count.
 */
export function CountUp({ value }: { value: string | number }) {
  const target = typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(() => target === null || matchMedia("(prefers-reduced-motion: reduce)").matches ? value : 0);

  useEffect(() => {
    const element = ref.current;
    if (target === null || !element || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
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
  }, [target, value]);

  return <>
    <span ref={ref} aria-hidden="true">{shown}</span>
    <span className="sr-only">{value}</span>
  </>;
}
