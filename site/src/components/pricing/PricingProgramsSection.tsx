import { EARLY_ACCESS_URL, PRICING_PROGRAMS } from "../../constants/pricing";
import { cx } from "../../helpers/cx";
import { card, cardCopy, cardTitle, pricingSection, textLink } from "../../styles/classes";
import { SectionHeading } from "../shared/SectionHeading";
import { Card } from "../ui/card";

export function PricingProgramsSection() {
  return (
    <section className={pricingSection} aria-labelledby="programs-title">
      <SectionHeading id="programs-title" kicker="Programs">
        Free for open source.
      </SectionHeading>
      <div className="grid grid-cols-2 gap-4 mobile:grid-cols-[1fr]">
        {PRICING_PROGRAMS.map(({ title, copy }) => (
          <Card key={title} className={cx(card, "flex flex-col p-(--spacing-card)")}>
            <h3 className={cardTitle}>{title}</h3>
            <p className={cx(cardCopy, "mt-3")}>{copy}</p>
            <a className={cx(textLink, "mt-6 self-start")} href={EARLY_ACCESS_URL}>
              Apply
            </a>
          </Card>
        ))}
      </div>
    </section>
  );
}
