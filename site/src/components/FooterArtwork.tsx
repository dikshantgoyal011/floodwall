import { useEffect, useState, type RefObject } from "react";
import { FOOTER_PRINT_WIDTHS } from "../content";

/** How far ahead of the viewport the fog and boat sprites start loading. */
const SPRITE_LOAD_MARGIN = "600px";

/** Independent print layers keep the skyline still while fog and boats travel. */
export function FooterArtwork({ running, rootRef }: { running: boolean; rootRef: RefObject<HTMLDivElement | null> }) {
  // SVG <image> has no lazy loading, so the sprites get their hrefs only as the footer nears view.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setNear(true);
      observer.disconnect();
    }, { rootMargin: SPRITE_LOAD_MARGIN });
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);
  const fog = near ? "/footer-fog.webp" : undefined;
  const boat = near ? "/footer-boat.webp" : undefined;
  const largest = FOOTER_PRINT_WIDTHS.at(-1);

  return (
    <div className="footer-artwork" data-running={running} ref={rootRef} aria-hidden="true">
      {/* The print spans the 1440px-capped footer plus its insets, so it never draws wider than the viewport or about 1506px. */}
      <img className="footer-water" src="/footer-water.webp" width="2164" height="727" alt="" loading="lazy" decoding="async"
        srcSet={FOOTER_PRINT_WIDTHS.map(width => `${width === largest ? "/footer-water.webp" : `/footer-water-${width}.webp`} ${width}w`).join(", ")}
        sizes="min(100vw, 1506px)" />
      <svg className="footer-atmosphere" viewBox="0 0 2164 727" focusable="false">
        <g className="footer-animated footer-fog footer-fog--high">
          <image href={fog} width="900" height="190" />
        </g>
        <g className="footer-animated footer-fog footer-fog--bridge">
          <image href={fog} width="1100" height="232" />
        </g>
        <g className="footer-animated footer-fog footer-fog--low">
          <image href={fog} width="1000" height="211" />
        </g>
        <g className="footer-animated footer-boat footer-boat--far">
          <image href={boat} x="500" y="515" width="42" height="57" />
        </g>
        <g className="footer-animated footer-boat footer-boat--middle">
          <image href={boat} x="1040" y="540" width="64" height="86" />
        </g>
        <g className="footer-animated footer-boat footer-boat--near">
          <image href={boat} x="1850" y="530" width="100" height="135" />
        </g>
      </svg>
    </div>
  );
}
