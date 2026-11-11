import { LandingSectionHeading } from "./LandingSectionHeading";
import { MODEL_STAGES } from "../../constants/landing";

export function LandingModelSection() {
  return (
    <section className="section" id="model" aria-labelledby="model-title">
      <div className="section-drawing">
        <LandingSectionHeading id="model-title" kicker="The model">
          Agents submit intents. <strong>Floodwall governs.</strong>
        </LandingSectionHeading>
        <div className="model-rail">
          {MODEL_STAGES.map(({ title, copy }) => (
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
