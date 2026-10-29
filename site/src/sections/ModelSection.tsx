import { SectionHeading } from "../components/SectionHeading";
import { MODEL_STAGES } from "../content";

export function ModelSection() {
  return (
    <section className="section" id="model" aria-labelledby="model-title">
      <div className="section-drawing">
        <SectionHeading id="model-title" kicker="The model">
          Agents submit intents. <strong>Floodwall governs.</strong>
        </SectionHeading>
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
