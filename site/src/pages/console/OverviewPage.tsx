import { Link } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleOpenIntent } from "../../components/console/ConsoleOpenIntent";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { ConsoleStats } from "../../components/console/ConsoleStats";
import { CONSOLE_PATHS, OVERVIEW_STATS } from "../../constants/console";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow } from "../../styles/classes";

export function OverviewPage() {
  const { state, dispatch } = usePlane();
  const hasQueued = state.intents.some((i) => i.status === "queued");
  const recent = state.ledger.slice(-5).reverse();

  return (
    <>
      <ConsolePageHeader
        title="Overview"
        description={`Logical tick ${state.tick}. Run a tick to gate everything in the queue.`}
        actions={
          <>
            <ConsoleButton variant="secondary" to={CONSOLE_PATHS.newIntent}>
              Submit intent
            </ConsoleButton>
            <ConsoleButton onClick={() => dispatch({ type: "tick" })} disabled={!hasQueued}>
              Run tick
            </ConsoleButton>
          </>
        }
      />

      <ConsoleStats
        label="Plane state"
        stats={OVERVIEW_STATS.map(({ label, hint, value }) => ({ label, hint, value: value(state) }))}
      />

      <ConsolePanel
        title="Recent decisions"
        flush
        action={
          <Link className={consoleLink} to={CONSOLE_PATHS.ledger}>
            Open ledger
          </Link>
        }
      >
        {recent.length === 0 ? (
          <ConsoleEmpty title="Nothing recorded yet">Decisions appear here as the gate rules on intents.</ConsoleEmpty>
        ) : (
          <ul className={consoleList}>
            {recent.map((record) => (
              <li key={record.seq} className={consoleRow}>
                <span className={cx(consoleMono, "w-8 shrink-0 text-muted")}>#{record.seq}</span>
                <span className={consoleGrow}>
                  <span className="font-medium text-ink">{record.agent}</span>
                  <span className="text-muted"> · {record.summary}</span>
                </span>
                {record.verdict ? (
                  <ConsoleBadge value={record.verdict} />
                ) : (
                  <span className="font-mono text-[11px] text-muted">{record.kind}</span>
                )}
                {/* The decision's intent as a chip: the way into it from here. */}
                <ConsoleOpenIntent id={record.intentId}>
                  <span className={consoleMono}>#{record.intentId}</span>
                </ConsoleOpenIntent>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>
    </>
  );
}
