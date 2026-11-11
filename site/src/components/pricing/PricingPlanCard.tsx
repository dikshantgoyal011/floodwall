import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import type { PricingPlan } from "../../constants/pricing";
import { Icon } from "../shared/Icon";

/**
 * One plan in the rail: its price, who it's for, what it includes, and how to start. The plan most
 * teams start on is marked in its title band and carries the one filled button.
 */
export function PricingPlanCard({ plan }: { plan: PricingPlan }) {
  const { name, price, priceNote, summary, typical, features, cta, featured } = plan;

  return (
    <li className="plan" data-featured={featured || undefined}>
      <div className="plan-head">
        <h2 className="tag">{name}</h2>
        {featured && <span className="plan-mark">Most teams</span>}
      </div>
      <p className="plan-price">
        <span className="plan-amount">{price}</span>
        <span className="plan-unit">{priceNote}</span>
      </p>
      <div className="plan-body">
        <p className="card-copy">{summary}</p>
        {typical && (
          <p className="plan-typical">
            Typical spend <strong>{typical.spend}/mo</strong> for {typical.basis}
          </p>
        )}
      </div>
      <ul className="plan-features">
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div className="plan-cta">
        {featured ? (
          <a className="button button-lg" href={cta.href}>
            {cta.label} <Icon icon={ArrowRight02Icon} className="button-arrow" />
          </a>
        ) : (
          <a className="hero-link" href={cta.href}>
            {cta.label} <Icon icon={ArrowRight02Icon} />
          </a>
        )}
      </div>
    </li>
  );
}
