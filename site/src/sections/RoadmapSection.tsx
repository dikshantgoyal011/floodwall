import { SectionHeading } from "../components/SectionHeading";
import { ROADMAP } from "../content";

export function RoadmapSection() {
  return (
    <section className="section" id="roadmap" aria-labelledby="roadmap-title">
      <div className="section-drawing">
        <SectionHeading id="roadmap-title" kicker="Roadmap">
          Ledger on disk. <strong>Replay comes next.</strong>
        </SectionHeading>
        <ol className="roadmap-grid">
          {ROADMAP.map(({ version, title, copy }) => (
            <li className="card roadmap-card" key={version}>
              <span className="tag">{version}</span>
              <div className="roadmap-copy">
                <h3>{title}</h3>
                <p className="card-copy">{copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
