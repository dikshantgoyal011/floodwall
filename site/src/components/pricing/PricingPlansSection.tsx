import { ENTERPRISE_PLAN, PRICING_PLANS } from "../../constants/pricing";
import { cx } from "../../helpers/cx";
import { card, cardCopy, cardTitle, pageWidth } from "../../styles/classes";
import { ButtonLink } from "../shared/ButtonLink";
import { Card } from "../ui/card";
import { PricingPlanCard } from "./PricingPlanCard";

/** The plans side by side, with Enterprise across the foot of them. */
export function PricingPlansSection() {
  return (
    <section className={pageWidth} aria-label="Plans">
      <div className="grid grid-cols-4 gap-4 tablet:grid-cols-2 mobile:grid-cols-[1fr]">
        {PRICING_PLANS.map((plan) => (
          <PricingPlanCard key={plan.name} plan={plan} />
        ))}
      </div>
      <Card className={cx(card, "mt-4 flex flex-row flex-wrap items-center justify-between gap-6 p-(--spacing-card)")}>
        <div className="max-w-180">
          <h2 className={cardTitle}>{ENTERPRISE_PLAN.name}</h2>
          <p className={cx(cardCopy, "mt-2")}>{ENTERPRISE_PLAN.copy}</p>
        </div>
        <ButtonLink href={ENTERPRISE_PLAN.cta.href} size="sm">
          {ENTERPRISE_PLAN.cta.label}
        </ButtonLink>
      </Card>
    </section>
  );
}
