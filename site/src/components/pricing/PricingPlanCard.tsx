import type { PricingPlan } from "../../constants/pricing";
import { cx } from "../../helpers/cx";
import { bulletItem, card, cardCopy, cardTitle } from "../../styles/classes";
import { ButtonLink } from "../shared/ButtonLink";
import { Tag } from "../shared/Tag";
import { Card } from "../ui/card";

/** One plan: its price, who it's for, what it includes, and how to start. */
export function PricingPlanCard({ plan }: { plan: PricingPlan }) {
  const { name, price, priceNote, summary, typical, features, cta, featured } = plan;

  return (
    <Card className={cx(card, "flex flex-col p-(--spacing-card)", featured && "border-bridge shadow-card")}>
      <div className="flex min-h-7.5 items-center justify-between gap-3">
        <h2 className={cardTitle}>{name}</h2>
        {featured && <Tag>Most teams</Tag>}
      </div>
      <p className="mt-6 flex flex-col gap-2">
        <span className="font-display text-display-md leading-none text-ink">{price}</span>
        <span className="text-sm text-muted">{priceNote}</span>
      </p>
      <p className={cx(cardCopy, "mt-4")}>{summary}</p>
      {typical && (
        <p className="mt-4 text-sm leading-normal text-ink-soft">
          Typical spend <strong className="text-ink">{typical.spend}/mo</strong> for {typical.basis}
        </p>
      )}
      <ul className="mt-6 grid gap-3 border-t border-t-line pt-6">
        {features.map((feature) => (
          <li key={feature} className={bulletItem}>
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-8">
        <ButtonLink href={cta.href} size="sm">
          {cta.label}
        </ButtonLink>
      </div>
    </Card>
  );
}
