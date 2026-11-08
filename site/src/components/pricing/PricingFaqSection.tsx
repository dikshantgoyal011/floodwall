import { PRICING_FAQ } from "../../constants/pricing";
import { LandingSectionHeading } from "../landing/LandingSectionHeading";

export function PricingFaqSection() {
  return (
    <section className="section" aria-labelledby="faq-title">
      <div className="section-drawing">
        <LandingSectionHeading id="faq-title" kicker="Questions">
          How <strong>pricing works.</strong>
        </LandingSectionHeading>
        <dl className="faq-grid">
          {PRICING_FAQ.map(({ question, answer }) => (
            <div className="faq-item" key={question}>
              <dt className="faq-question">{question}</dt>
              <dd className="card-copy">{answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
