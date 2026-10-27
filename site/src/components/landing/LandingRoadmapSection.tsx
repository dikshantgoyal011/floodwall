import { ROADMAP } from "../../constants/landing";
import { cx } from "../../helpers/cx";
import { card, cardCopy, cardTitle, landingSection } from "../../styles/classes";
import { SectionHeading } from "../shared/SectionHeading";
import { Tag } from "../shared/Tag";
import { Card } from "../ui/card";

export function LandingRoadmapSection() {
  return (
    <section className={landingSection} id="roadmap" aria-labelledby="roadmap-title">
      <SectionHeading id="roadmap-title" kicker="Roadmap">
        From a wall to a replayable control plane.
      </SectionHeading>
      <ol className="grid grid-cols-4 gap-4 tablet:grid-cols-2 mobile:grid-cols-[1fr]">
        {ROADMAP.map(({ version, title, copy }) => (
          // The <li> keeps the list's semantics; the card inside fills its grid cell.
          <li key={version}>
            <Card className={cx(card, "h-full p-(--spacing-card)")}>
              <Tag>{version}</Tag>
              <h3 className={cx(cardTitle, "mt-6 mb-3")}>{title}</h3>
              <p className={cardCopy}>{copy}</p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
