import { IsometricDiagram, type FigureName } from "../components/IsometricDiagram";
import { SectionHeading } from "../components/SectionHeading";
import { useClientValue } from "../hooks";

const CRATE_STATS = [
  { value: __CRATE_STATS__.version, label: "shipped" },
  { value: __CRATE_STATS__.dependencies, label: "dependencies" },
  { value: __CRATE_STATS__.tests, label: "tests" },
];

export function LineSection() {
  const variant = useClientValue<FigureName>(
    () => new URLSearchParams(location.search).get("hero") === "stack" ? "control-stack" : "processing-line",
    "processing-line",
  );
  return (
    <section className="section" id="line" aria-labelledby="line-title">
      <div className="section-drawing">
        <SectionHeading id="line-title" kicker="The processing line">
          Every intent gets a verdict. <strong>Production only sees the admitted ones.</strong>
        </SectionHeading>
        <IsometricDiagram variant={variant} stats={CRATE_STATS} />
      </div>
    </section>
  );
}
