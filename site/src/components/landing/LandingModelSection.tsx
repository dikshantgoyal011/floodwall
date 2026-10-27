import { MODEL_STAGES } from "../../constants/landing";
import { landingSection } from "../../styles/classes";
import { CardRail } from "../shared/CardRail";
import { SectionHeading } from "../shared/SectionHeading";

export function LandingModelSection() {
  return (
    <section className={landingSection} id="model" aria-labelledby="model-title">
      <SectionHeading id="model-title" kicker="The model">
        Agents submit intents. Production gets decisions.
      </SectionHeading>
      <CardRail items={MODEL_STAGES} className="grid-cols-3 tablet:grid-cols-[1fr]" />
    </section>
  );
}
