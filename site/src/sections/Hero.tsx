import { IsometricDiagram } from "../components/IsometricDiagram";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../components/Icon";
import { REPO_URL } from "../content";

const CRATE_STATS = [
  { value: __CRATE_STATS__.version, label: "shipped" },
  { value: __CRATE_STATS__.dependencies, label: "dependencies" },
  { value: __CRATE_STATS__.tests, label: "tests" },
];

export function Hero() {
  const variant = new URLSearchParams(location.search).get("hero") === "stack" ? "control-stack" : "processing-line";
  return (
    <section className="hero" id="home" aria-labelledby="hero-title">
      <div className="hero-content">
        <div className="hero-intro">
          <h1 className="staccato-heading" id="hero-title">Agents flood production. <strong>Hold the line.</strong></h1>
          <p className="hero-lead">
            Floodwall meters agent-generated infrastructure changes, verifies each intent at a policy
            gate, and records every admit, defer, and reject in a tamper-evident ledger.
          </p>
          <div className="hero-actions">
            <a className="button button-lg" href={REPO_URL}>View the Crate <Icon icon={ArrowRight02Icon} /></a>
            <a className="hero-link" href="#model">Read the model <Icon icon={ArrowRight02Icon} /></a>
          </div>
        </div>
        <IsometricDiagram variant={variant} stats={CRATE_STATS} />
      </div>
    </section>
  );
}
