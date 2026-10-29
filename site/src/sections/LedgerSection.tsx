import { LEDGER_ENTRIES, LEDGER_FACTS, LEDGER_HEAD_DIGEST } from "../content";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../components/Icon";
import { SectionHeading } from "../components/SectionHeading";

export function LedgerSection() {
  return (
    <section
      className="section"
      id="ledger"
      aria-labelledby="ledger-title"
    >
      <div className="section-drawing">
        <SectionHeading id="ledger-title" kicker="Tamper-evident ledger">
          Chained records. <strong>Independent proof.</strong>
        </SectionHeading>
        <div className="section-body">
          <div className="card feature-card">
            <p className="feature-copy">
              Every decision, release, expiry, and outcome is appended with its evidence: the action,
              the reason, and each policy&rsquo;s verdict. A retroactive edit anywhere in history
              breaks the chain.
            </p>
            <ul className="feature-points">
              {LEDGER_FACTS.map((fact) => (
                <li key={fact}><Icon icon={Tick02Icon} size={16} /><span>{fact}</span></li>
              ))}
            </ul>
          </div>
          <div className="card evidence-panel">
            <div className="panel-head">
              <span>Recent records</span>
              <span className="panel-status"><Icon icon={Tick02Icon} size={16} />Valid chain</span>
            </div>
            <ol className="panel-rows">
              {LEDGER_ENTRIES.map(({ verdict, agent, intent }) => (
                <li className="ledger-row" key={`${verdict}-${agent}`}>
                  <span className={`verdict verdict-${verdict}`}>{verdict}</span>
                  <span>{agent}</span>
                  <span>{intent}</span>
                </li>
              ))}
            </ol>
            <div className="panel-foot">
              <span>Head digest</span>
              <code>{LEDGER_HEAD_DIGEST}</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
