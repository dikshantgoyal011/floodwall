import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ConsoleBackLink } from "../../components/console/ConsoleBackLink";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleIntentSteps } from "../../components/console/ConsoleIntentSteps";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { CONSOLE_PATHS } from "../../constants/console";
import { describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow, monoLabel } from "../../styles/classes";

export function IntentDetailPage() {
  const { id } = useParams();
  const { state } = usePlane();
  const intent = state.intents.find((i) => String(i.id) === id);

  if (!intent) {
    return (
      <>
        <ConsoleBackLink to={CONSOLE_PATHS.intents}>Intents</ConsoleBackLink>
        <ConsolePageHeader title="Intent not found" description={`No intent has the id ${id}. It may be from another plane.`} />
        <ConsolePanel>
          <Link className={consoleLink} to={CONSOLE_PATHS.intents}>
            See all intents
          </Link>
        </ConsolePanel>
      </>
    );
  }

  const history = state.ledger.filter((r) => r.intentId === intent.id);
  const facts = [
    { label: "Status", value: <ConsoleBadge value={intent.status} /> },
    { label: "Agent", value: intent.agent },
    { label: "Priority", value: intent.priority },
    { label: "Blast radius", value: intent.blast },
    { label: "Submitted", value: `tick ${intent.submittedAt}` },
    ...(intent.releasedBy ? [{ label: "Released by", value: intent.releasedBy }] : []),
  ];

  return (
    <>
      <ConsoleBackLink to={CONSOLE_PATHS.intents}>Intents</ConsoleBackLink>
      <ConsolePageHeader
        title={`Intent #${intent.id}`}
        description={describeAction(intent.action)}
        actions={<ConsoleIntentSteps intent={intent} />}
      />

      <ConsoleFacts facts={facts} />

      <ConsolePanel title="Gate verdicts" flush action="Harshest verdict wins">
        {intent.verdicts ? (
          <ul className={consoleList}>
            {intent.verdicts.map((v) => (
              <li key={v.policy} className={consoleRow}>
                <span className={consoleGrow}>
                  <code className="text-ink">{v.policy}</code>
                  {v.reason && <span className="text-muted"> · {v.reason}</span>}
                </span>
                <ConsoleBadge value={v.verdict} />
              </li>
            ))}
          </ul>
        ) : (
          <ConsoleEmpty title="Not gated yet">Run a tick to send it through the gate.</ConsoleEmpty>
        )}
      </ConsolePanel>

      <ConsolePanel title="Ledger history" flush>
        {history.length ? (
          <ul className={consoleList}>
            {history.map((r) => (
              <li key={r.seq} className={consoleRow}>
                <span className={cx(consoleMono, "w-8 shrink-0 text-muted")}>#{r.seq}</span>
                <span className={consoleGrow}>
                  <span className="font-medium text-ink">{r.kind}</span>
                  <span className="text-muted"> · {r.summary}</span>
                </span>
                <span className={cx(consoleMono, "text-muted")}>tick {r.tick}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ConsoleEmpty title="Nothing recorded yet">The ledger records this intent once the gate rules on it.</ConsoleEmpty>
        )}
      </ConsolePanel>
    </>
  );
}

/**
 * The intent's facts in one ruled frame, the Overview figures' title-block cells. Each cell draws its
 * own right and bottom rule and the frame clips the outermost, so a short last row leaves no gap.
 */
function ConsoleFacts({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return (
    <div className="overflow-hidden border border-line bg-surface">
      <dl className="-me-px -mb-px grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {facts.map(({ label, value }) => (
          <div key={label} className="flex min-w-0 flex-col gap-2 border-e border-b border-line px-5 py-4 console-narrow:px-4">
            <dt className={monoLabel}>{label}</dt>
            <dd className="text-[15px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
