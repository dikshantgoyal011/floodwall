import { Link } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleOpenIntent } from "../../components/console/ConsoleOpenIntent";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsoleStat } from "../../components/console/ConsoleStat";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { CONSOLE_PATHS, OVERVIEW_STATS } from "../../constants/console";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleGrow, consoleList, consoleMono, consoleRow } from "../../styles/classes";

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

      <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {OVERVIEW_STATS.map(({ label, hint, value }) => (
          <ConsoleStat key={label} label={label} value={value(state)} hint={hint} />
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent decisions</CardTitle>
          <CardAction>
            <Link className="font-semibold text-bay-deep" to={CONSOLE_PATHS.ledger}>
              Open ledger
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className={consoleList}>
            {recent.map((record) => (
              <li key={record.seq} className={consoleRow}>
                <span className={cx(consoleMono, "text-muted")}>#{record.seq}</span>
                <span className={consoleGrow}>
                  <strong>{record.agent}</strong>
                  <span className="text-muted"> · {record.summary}</span>
                </span>
                {record.verdict ? (
                  <ConsoleBadge value={record.verdict} />
                ) : (
                  <span className="text-muted">{record.kind}</span>
                )}
                {/* The decision's intent as a chip: the way into it from here. */}
                <ConsoleOpenIntent id={record.intentId}>
                  <span className={consoleMono}>#{record.intentId}</span>
                </ConsoleOpenIntent>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
