import { IsometricDiagram, type FigureName } from "./IsometricDiagram";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { useClientValue } from "../../hooks/useClientValue";

const CRATE_STATS = [
  { value: __CRATE_STATS__.version, label: "shipped" },
  { value: __CRATE_STATS__.dependencies, label: "dependencies" },
  { value: __CRATE_STATS__.tests, label: "tests" },
];

export function LandingLineSection() {
  const variant = useClientValue<FigureName>(
    () => new URLSearchParams(location.search).get("hero") === "stack" ? "control-stack" : "processing-line",
    "processing-line",
  );
  return (
    <section className="section" id="line" aria-labelledby="line-title">
      <div className="section-drawing">
        <LandingSectionHeading id="line-title" kicker="The processing line">
          Every intent gets a verdict. <strong>Production only sees the admitted ones.</strong>
        </LandingSectionHeading>
        <IsometricDiagram variant={variant} stats={CRATE_STATS} />
      </div>
    </section>
  );
}
