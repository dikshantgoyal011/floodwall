import { INCLUDED_EVERYWHERE } from "../../constants/pricing";
import { pricingSection } from "../../styles/classes";
import { CardRail } from "../shared/CardRail";
import { SectionHeading } from "../shared/SectionHeading";

export function PricingIncludedSection() {
  return (
    <section className={pricingSection} aria-labelledby="included-title">
      <SectionHeading id="included-title" kicker="Every plan">
        The wall is the same everywhere.
      </SectionHeading>
      <CardRail items={INCLUDED_EVERYWHERE} className="grid-cols-4 tablet:grid-cols-2 mobile:grid-cols-[1fr]" />
    </section>
  );
}
