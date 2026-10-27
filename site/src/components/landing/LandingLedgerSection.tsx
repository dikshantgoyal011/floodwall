import { LEDGER_ENTRIES, LEDGER_FACTS, LEDGER_HEAD_DIGEST } from "../../constants/landing";
import { cx } from "../../helpers/cx";
import { landingSection, panelRow, panelRows } from "../../styles/classes";
import { DarkPanel } from "../shared/DarkPanel";
import { FeatureCard } from "../shared/FeatureCard";
import { VerdictLabel } from "../shared/VerdictLabel";

export function LandingLedgerSection() {
  return (
    // Ledger mirrors Gate on wide screens: panel left, copy right. The copy
    // stays first in the markup so it reads first everywhere else. Its card
    // also carries bullet points, so it takes the wider column to keep them on
    // one line and the section within a screen; the ledger rows are short.
    <section
      className={cx(
        landingSection,
        "grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-8 tablet:grid-cols-[1fr] mobile:gap-6",
      )}
      id="ledger"
      aria-labelledby="ledger-title"
    >
      <FeatureCard
        kicker="Tamper-evident ledger"
        titleId="ledger-title"
        title="Every verdict, chained and signed."
        points={LEDGER_FACTS}
        className="order-2 tablet:order-0"
      >
        Every decision, release, expiry, and outcome is appended with its evidence: the action, the
        reason, and each policy&rsquo;s verdict. A retroactive edit anywhere in history breaks the
        chain.
      </FeatureCard>
      <DarkPanel
        title="Recent records"
        note="Valid chain"
        noteIsStatus
        footLabel="Head digest"
        footCode={LEDGER_HEAD_DIGEST}
      >
        <ol className={panelRows}>
          {LEDGER_ENTRIES.map(({ verdict, agent, intent }) => (
            <li
              className={cx(
                panelRow,
                "grid grid-cols-[88px_1fr_1.2fr] gap-4 px-4 py-3 mobile:grid-cols-[1fr] mobile:gap-1",
              )}
              key={`${verdict}-${agent}`}
            >
              <VerdictLabel verdict={verdict} variant="text" />
              <span>{agent}</span>
              <span>{intent}</span>
            </li>
          ))}
        </ol>
      </DarkPanel>
    </section>
  );
}
