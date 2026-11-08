import { INCLUDED_EVERYWHERE } from "../../constants/pricing";
import { LandingSectionHeading } from "../landing/LandingSectionHeading";

/** What every plan gets from the crate itself, as four ruled stages like the landing page's model. */
export function PricingIncludedSection() {
  return (
    <section className="section" aria-labelledby="included-title">
      <div className="section-drawing">
        <LandingSectionHeading id="included-title" kicker="Every plan">
          The wall is <strong>the same everywhere.</strong>
        </LandingSectionHeading>
        <div className="model-rail">
          {INCLUDED_EVERYWHERE.map(({ title, copy }) => (
            <article className="model-stage" key={title}>
              <h3 className="tag">{title}</h3>
              <p className="card-copy">{copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
