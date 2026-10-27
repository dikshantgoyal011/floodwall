import { Link, useParams } from "react-router";
import { ConsoleBackLink } from "../../components/console/ConsoleBackLink";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleIntentSteps } from "../../components/console/ConsoleIntentSteps";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { CONSOLE_PATHS } from "../../constants/console";
import { describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleGrow, consoleLabel, consoleList, consoleMono, consoleRow } from "../../styles/classes";

export function IntentDetailPage() {
  const { id } = useParams();
  const { state } = usePlane();
  const intent = state.intents.find((i) => String(i.id) === id);

  if (!intent) {
    return (
      <>
        <ConsolePageHeader title="Intent not found" />
        <Link to={CONSOLE_PATHS.intents}>Back to intents</Link>
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

      <Card>
        <CardContent>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-5">
            {facts.map(({ label, value }) => (
              <div key={label}>
                <dt className={cx(consoleLabel, "mb-1.5")}>{label}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gate verdicts</CardTitle>
          <CardAction className="text-muted">Harshest verdict wins</CardAction>
        </CardHeader>
        <CardContent>
          {intent.verdicts ? (
            <ul className={consoleList}>
              {intent.verdicts.map((v) => (
                <li key={v.policy} className={consoleRow}>
                  <span className={consoleGrow}>
                    <code>{v.policy}</code>
                    {v.reason && <span className="text-muted"> · {v.reason}</span>}
                  </span>
                  <ConsoleBadge value={v.verdict} />
                </li>
              ))}
            </ul>
          ) : (
            <ConsoleEmpty>Not gated yet. Run a tick to send it through the gate.</ConsoleEmpty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <ul className={consoleList}>
              {history.map((r) => (
                <li key={r.seq} className={consoleRow}>
                  <span className={cx(consoleMono, "text-muted")}>#{r.seq}</span>
                  <span className={consoleGrow}>
                    {r.kind} · {r.summary}
                  </span>
                  <span className="text-muted">tick {r.tick}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ConsoleEmpty>Nothing recorded yet.</ConsoleEmpty>
          )}
        </CardContent>
      </Card>
    </>
  );
}
