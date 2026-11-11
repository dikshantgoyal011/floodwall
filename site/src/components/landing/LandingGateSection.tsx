import { GATE_POLICIES } from "../../constants/landing";
import { Cancel01Icon, PauseIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../shared/Icon";
import { LandingSectionHeading } from "./LandingSectionHeading";

const VERDICT_ICONS = { admit: Tick02Icon, defer: PauseIcon, reject: Cancel01Icon };

export function LandingGateSection() {
  return (
    <section className="section" id="gate" aria-labelledby="gate-title">
      <div className="section-drawing">
        <LandingSectionHeading id="gate-title" kicker="Policy gate">
          Many policies. <strong>One verdict.</strong>
        </LandingSectionHeading>
        <div className="section-body">
          <div className="card feature-card">
            <p className="feature-copy">
              Reference policies cover global destructive actions, blast-radius urgency, and resource
              allowlists. The policy trait stays small so teams can add rules that match their own
              release discipline. A deferred change is held, not dropped, until a human releases or
              expires it.
            </p>
          </div>
          <div className="card evidence-panel">
            <div className="panel-head">
              <span>Reference policies</span>
              <span>Harshest verdict wins</span>
            </div>
            <ul className="panel-rows">
              {GATE_POLICIES.map(({ name, rule, verdict }) => (
                <li className="policy-row" key={name}>
                  <div>
                    <code>{name}</code>
                    <p>{rule}</p>
                  </div>
                  <span className={`verdict-badge verdict-${verdict}`}><Icon icon={VERDICT_ICONS[verdict]} size={14} />{verdict}</span>
                </li>
              ))}
            </ul>
            <div className="panel-foot">
              <span>Add your own</span>
              <code>impl Policy for YourRule</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
