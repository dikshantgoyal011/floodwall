import { ArrowRight02Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HalftoneField } from "../components/HalftoneField";
import { Icon } from "../components/Icon";
import { REPO_URL } from "../content";

export function Hero() {
  return (
    <section className="hero" id="home" aria-labelledby="hero-title">
      <HalftoneField />
      <div className="hero-intro">
        <h1 className="staccato-heading" id="hero-title">When agents flood production, <strong>hold the line.</strong></h1>
        <p className="hero-lead">
          Floodwall meters agent-generated infrastructure changes, verifies each intent at a policy
          gate, and records every admit, defer, and reject in a tamper-evident ledger.
        </p>
        <div className="hero-actions">
          <a className="button button-lg" href={REPO_URL}><Icon icon={GithubIcon} className="button-brand" />View the Crate <Icon icon={ArrowRight02Icon} className="button-arrow" /></a>
          <a className="hero-link" href="#model">Read the model <Icon icon={ArrowRight02Icon} /></a>
        </div>
      </div>
    </section>
  );
}
