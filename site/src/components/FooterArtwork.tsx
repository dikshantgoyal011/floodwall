import type { Ref } from "react";
import { FOOTER_PRINT_URL } from "../content";

/** Independent print layers keep the skyline still while fog and boats travel. */
export function FooterArtwork({ running, rootRef }: { running: boolean; rootRef: Ref<HTMLDivElement> }) {
  return (
    <div className="footer-artwork" data-running={running} ref={rootRef} aria-hidden="true">
      <img className="footer-water" src={FOOTER_PRINT_URL} width="2164" height="727" alt="" loading="lazy" decoding="async" />
      <svg className="footer-atmosphere" viewBox="0 0 2164 727" focusable="false">
        <g className="footer-animated footer-fog footer-fog--high">
          <image href="/footer-fog.webp" width="900" height="190" />
        </g>
        <g className="footer-animated footer-fog footer-fog--bridge">
          <image href="/footer-fog.webp" width="1100" height="232" />
        </g>
        <g className="footer-animated footer-fog footer-fog--low">
          <image href="/footer-fog.webp" width="1000" height="211" />
        </g>
        <g className="footer-animated footer-boat footer-boat--far">
          <image href="/footer-boat.webp" x="500" y="515" width="42" height="57" />
        </g>
        <g className="footer-animated footer-boat footer-boat--middle">
          <image href="/footer-boat.webp" x="1040" y="540" width="64" height="86" />
        </g>
        <g className="footer-animated footer-boat footer-boat--near">
          <image href="/footer-boat.webp" x="1850" y="530" width="100" height="135" />
        </g>
      </svg>
    </div>
  );
}
