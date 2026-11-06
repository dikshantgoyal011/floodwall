import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { Link } from "react-router";
import { AUTH_PATHS } from "../../constants/auth";
import { Icon } from "../shared/Icon";
import { LandingSectionHeading } from "./LandingSectionHeading";

// The waitlist is the site's own: signing up at /signup puts a new account on it until an admin
// approves it. The Tally early-access form this section embedded before is kept below, commented
// out. To bring it back, restore this code and the form in the section, and add TALLY_ORIGIN back to
// script-src, frame-src and connect-src in the page's CSP (vite.config.ts).
//
// import { useEffect } from "react";
// import { TALLY_ORIGIN, WAITLIST_EMBED_URL, WAITLIST_FORM_URL } from "../../constants/landing";
//
// // Tally's embed sizes the form with iframe-resizer and strips any `sandbox` it finds, so the
// // page's CSP (vite.config.ts) is what limits it: scripts and frames from Tally only. The page's
// // CSS cannot reach into the frame; the form's look lives in Tally's Custom CSS (site/tally/custom.css).
// const TALLY_SCRIPT_URL = `${TALLY_ORIGIN}/widgets/embed.js`;
//
// declare global {
//   interface Window {
//     Tally?: { loadEmbeds: () => void };
//   }
// }
//
// /** Load Tally's embed script once; it fills in and resizes iframe[data-tally-src]. */
// function loadTallyEmbeds() {
//   const fallback = () => {
//     document.querySelectorAll<HTMLIFrameElement>("iframe[data-tally-src]:not([src])").forEach((frame) => {
//       frame.src = frame.dataset.tallySrc ?? "";
//     });
//   };
//   const load = () => (window.Tally ? window.Tally.loadEmbeds() : fallback());
//
//   if (window.Tally) {
//     load();
//   } else if (!document.querySelector(`script[src="${TALLY_SCRIPT_URL}"]`)) {
//     const script = document.createElement("script");
//     script.src = TALLY_SCRIPT_URL;
//     script.onload = load;
//     script.onerror = load;
//     document.body.appendChild(script);
//   }
// }

export function LandingWaitlistSection() {
  // useEffect(loadTallyEmbeds, []);

  return (
    <section className="section" id="waitlist" aria-labelledby="waitlist-title">
      <div className="section-drawing">
        <LandingSectionHeading id="waitlist-title" kicker="Early access">
          Gate your agents. <strong>Join the waitlist.</strong>
        </LandingSectionHeading>
        <div className="section-body">
          <div className="card feature-card">
            <p className="feature-copy">
              Sign up with your email, and we will let you in as early access opens.
            </p>
          </div>
          <div className="card waitlist-card waitlist-join">
            <Link className="button button-lg" to={AUTH_PATHS.signup}>
              Join the waitlist <Icon icon={ArrowRight02Icon} className="button-arrow" />
            </Link>
            <p className="waitlist-fallback">
              Already have an account? <Link to={AUTH_PATHS.login}>Sign in</Link>.
            </p>
          </div>
          {/*
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
          */}
        </div>
      </div>
    </section>
  );
}
