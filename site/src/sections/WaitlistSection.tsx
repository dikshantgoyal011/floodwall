import { useEffect } from "react";
import { SectionHeading } from "../components/SectionHeading";
import { TALLY_ORIGIN, WAITLIST_EMBED_URL, WAITLIST_FORM_URL } from "../content";

// Tally's embed sizes the form with iframe-resizer and strips any `sandbox` it finds, so the
// page's CSP (vite.config.ts) is what limits it: scripts and frames from Tally only. The page's
// CSS cannot reach into the frame; the form's look lives in Tally's Custom CSS (site/tally/custom.css).
const TALLY_SCRIPT_URL = `${TALLY_ORIGIN}/widgets/embed.js`;

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

/** Load Tally's embed script once; it fills in and resizes iframe[data-tally-src]. */
function loadTallyEmbeds() {
  const fallback = () => {
    document.querySelectorAll<HTMLIFrameElement>("iframe[data-tally-src]:not([src])").forEach((frame) => {
      frame.src = frame.dataset.tallySrc ?? "";
    });
  };
  const load = () => (window.Tally ? window.Tally.loadEmbeds() : fallback());

  if (window.Tally) {
    load();
  } else if (!document.querySelector(`script[src="${TALLY_SCRIPT_URL}"]`)) {
    const script = document.createElement("script");
    script.src = TALLY_SCRIPT_URL;
    script.onload = load;
    script.onerror = load;
    document.body.appendChild(script);
  }
}

export function WaitlistSection() {
  useEffect(loadTallyEmbeds, []);

  return (
    <section className="section" id="waitlist" aria-labelledby="waitlist-title">
      <div className="section-drawing">
        <SectionHeading id="waitlist-title" kicker="Early access">
          Gate your agents. <strong>Join the waitlist.</strong>
        </SectionHeading>
        <div className="section-body">
          <div className="card feature-card">
            <p className="feature-copy">
              Tell us which agent-driven changes you would gate, and we will reach out as early access
              opens.
            </p>
          </div>
          <div className="card waitlist-card">
            <iframe
              data-tally-src={WAITLIST_EMBED_URL}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              width="100%"
              height="620"
              title="Floodwall early access"
            />
            <p className="waitlist-fallback">
              Form not loading? <a href={WAITLIST_FORM_URL}>Open it on Tally</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
