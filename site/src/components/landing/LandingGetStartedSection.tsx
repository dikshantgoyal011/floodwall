import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { AUTH_PATHS } from "../../constants/auth";
import { EARLY_ACCESS_URL } from "../../constants/links";
import { Icon } from "../shared/Icon";
import { LandingSectionHeading } from "./LandingSectionHeading";

/** The Free plan, as /pricing offers it: signing up makes an account that opens the console. */
export function LandingGetStartedSection() {
  return (
    <section className="section" id="get-started" aria-labelledby="get-started-title">
      <div className="section-drawing">
        <LandingSectionHeading id="get-started-title" kicker="Free plan">
          Gate your agents. <strong>Start for free.</strong>
        </LandingSectionHeading>
        <div className="section-body">
          <div className="card feature-card">
            <p className="feature-copy">
              Create a free account with your email, then open the console with a plane of example intents. No
              credit card is needed.
            </p>
          </div>
          <div className="card get-started-card">
            <a className="button button-lg" href={EARLY_ACCESS_URL}>
              Get started free <Icon icon={ArrowRight02Icon} className="button-arrow" />
            </a>
            <p className="get-started-fallback">
              Already have an account? <a href={AUTH_PATHS.login}>Sign in</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
