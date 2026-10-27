import { GATE_POLICIES } from "../../constants/landing";
import { cx } from "../../helpers/cx";
import { landingSection, panelRow, panelRows } from "../../styles/classes";
import { DarkPanel } from "../shared/DarkPanel";
import { FeatureCard } from "../shared/FeatureCard";
import { VerdictLabel } from "../shared/VerdictLabel";

export function LandingGateSection() {
  return (
    <section
      className={cx(
        landingSection,
        "grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] gap-8 tablet:grid-cols-[1fr] mobile:gap-6",
      )}
      id="gate"
      aria-labelledby="gate-title"
    >
      <FeatureCard
        kicker="Policy gate"
        titleId="gate-title"
        title="One hard reject blocks the change."
      >
        Reference policies cover global destructive actions, blast-radius urgency, and resource
        allowlists. The policy trait stays small so teams can add rules that match their own release
        discipline. A deferred change is held, not dropped, until a human releases or expires it.
      </FeatureCard>
      <DarkPanel
        title="Reference policies"
        note="Harshest verdict wins"
        footLabel="Add your own"
        footCode="impl Policy for YourRule"
      >
        <ul className={panelRows}>
          {GATE_POLICIES.map(({ name, rule, verdict }) => (
            <li
              className={cx(panelRow, "flex items-start justify-between gap-4 p-4 mobile:flex-col mobile:gap-3")}
              key={name}
            >
              <div>
                <code className="font-mono text-sm font-semibold text-white">{name}</code>
                <p className="mt-1 text-sm leading-normal text-panel-dim">{rule}</p>
              </div>
              <VerdictLabel verdict={verdict} variant="badge" />
            </li>
          ))}
        </ul>
      </DarkPanel>
    </section>
  );
}
