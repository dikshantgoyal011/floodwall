import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { EARLY_ACCESS_URL } from "../../constants/links";
import { PRICING_PROGRAMS } from "../../constants/pricing";
import { LandingSectionHeading } from "../landing/LandingSectionHeading";
import { Icon } from "../shared/Icon";

export function PricingProgramsSection() {
  return (
    <section className="section" aria-labelledby="programs-title">
      <div className="section-drawing">
        <LandingSectionHeading id="programs-title" kicker="Programs">
          Free for <strong>open source.</strong>
        </LandingSectionHeading>
        <div className="model-rail program-rail">
          {PRICING_PROGRAMS.map(({ title, copy }) => (
            <article className="model-stage" key={title}>
              <h3 className="tag">{title}</h3>
              <p className="card-copy">{copy}</p>
              <a className="hero-link program-apply" href={EARLY_ACCESS_URL} aria-label={`Apply: ${title}`}>
                Apply <Icon icon={ArrowRight02Icon} />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
