import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { AUTH_PATHS } from "../../constants/auth";
import { EARLY_ACCESS_URL } from "../../constants/links";
import { Icon } from "../shared/Icon";
import { LandingSectionHeading } from "./LandingSectionHeading";

/** Early access, as /pricing offers it: signing up puts an account on the site's own waitlist. */
export function LandingWaitlistSection() {
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
          <div className="card waitlist-card">
            <a className="button button-lg" href={EARLY_ACCESS_URL}>
              Join the waitlist <Icon icon={ArrowRight02Icon} className="button-arrow" />
            </a>
            <p className="waitlist-fallback">
              Already have an account? <a href={AUTH_PATHS.login}>Sign in</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
