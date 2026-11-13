import { ArrowRight02Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { EARLY_ACCESS_URL, REPO_URL } from "../../constants/links";
import { ENTERPRISE_PLAN, PRICING_PLANS } from "../../constants/pricing";
import { LandingSectionHeading } from "../landing/LandingSectionHeading";
import { Icon } from "../shared/Icon";
import { PricingPlanCard } from "./PricingPlanCard";

/** The opening sheet: the offer, the four plans in one ruled rail, and Enterprise across their foot. */
export function PricingHero() {
  return (
    <section className="section pricing-intro" aria-labelledby="pricing-title">
      <div className="section-drawing">
        <LandingSectionHeading id="pricing-title" kicker="Pricing" level={1}>
          Free to self-host. <strong>Pay as you grow on Floodwall Cloud.</strong>
        </LandingSectionHeading>
        <div className="pricing-lead">
          <p className="feature-copy">
            The crate is open source and always free to run yourself. Floodwall Cloud hosts the ledger, approvals
            and console for you, billed by the decisions your agents&rsquo; changes need.
          </p>
          <div className="pricing-actions">
            <p className="pricing-note">Start on Free. Paid plans aren&rsquo;t billed yet</p>
            <div className="pricing-buttons">
              <a className="button button-lg" href={EARLY_ACCESS_URL}>
                Get started free <Icon icon={ArrowRight02Icon} className="button-arrow" />
              </a>
              <a className="hero-link" href={REPO_URL}>
                <Icon icon={GithubIcon} /> View the Crate <Icon icon={ArrowRight02Icon} />
              </a>
            </div>
          </div>
        </div>
        <ol className="plan-rail" aria-label="Plans">
          {PRICING_PLANS.map((plan) => (
            <PricingPlanCard key={plan.name} plan={plan} />
          ))}
        </ol>
        <div className="plan-enterprise">
          <div>
            <h2 className="tag">{ENTERPRISE_PLAN.name}</h2>
            <p className="card-copy">{ENTERPRISE_PLAN.copy}</p>
          </div>
          <a className="hero-link" href={ENTERPRISE_PLAN.cta.href}>
            {ENTERPRISE_PLAN.cta.label} <Icon icon={ArrowRight02Icon} />
          </a>
        </div>
      </div>
    </section>
  );
}
