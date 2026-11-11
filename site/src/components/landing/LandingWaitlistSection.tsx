import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { EARLY_ACCESS_URL } from "../../constants/links";
import { Icon } from "../shared/Icon";
import { LandingSectionHeading } from "./LandingSectionHeading";

/** Early access, as /pricing offers it: a request through the team's form on Tally. */
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
              Tell us which agent-driven changes you would gate, and we will reach out as early access
              opens.
            </p>
          </div>
          <div className="card waitlist-card">
            <a className="button button-lg" href={EARLY_ACCESS_URL}>
              Request early access <Icon icon={ArrowUpRight01Icon} className="button-arrow" />
            </a>
            <p className="waitlist-fallback">The request form opens on Tally.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
