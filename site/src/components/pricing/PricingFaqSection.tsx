import { PRICING_FAQ } from "../../constants/pricing";
import { cx } from "../../helpers/cx";
import { cardCopy, cardTitle, pricingSection } from "../../styles/classes";
import { SectionHeading } from "../shared/SectionHeading";

/** The last section, so it also keeps the page clear of the footer. */
export function PricingFaqSection() {
  return (
    <section className={cx(pricingSection, "pb-section")} aria-labelledby="faq-title">
      <SectionHeading id="faq-title" kicker="Questions">
        How pricing works.
      </SectionHeading>
      <dl className="grid grid-cols-2 gap-x-12 gap-y-10 tablet:grid-cols-[1fr]">
        {PRICING_FAQ.map(({ question, answer }) => (
          <div key={question}>
            <dt className={cardTitle}>{question}</dt>
            <dd className={cx(cardCopy, "mt-3")}>{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
