import { Link } from "react-router";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleIntentSteps } from "../../components/console/ConsoleIntentSteps";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { CONSOLE_PATHS } from "../../constants/console";
import { describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow, consoleSub } from "../../styles/classes";

export function HoldPage() {
  const { state } = usePlane();
  const held = state.intents.filter((i) => i.status === "held");

  return (
    <>
      <ConsolePageHeader
        title="Hold queue"
        description="Deferred intents wait here. Releasing waives their deferrals; rejections still apply."
      />

      <ConsolePanel title={`${held.length} on hold`} flush>
        {held.length === 0 ? (
          <ConsoleEmpty
            title="Nothing on hold"
            action={
              <Link className={consoleLink} to={CONSOLE_PATHS.intents}>
                See all intents
              </Link>
            }
          >
            When a policy defers an intent, it waits here until a person releases or expires it.
          </ConsoleEmpty>
        ) : (
          <ul className={consoleList}>
            {held.map((intent) => (
              <li key={intent.id} className={`${consoleRow} flex-wrap`}>
                <span className={consoleGrow}>
                  <Link className={consoleLink} to={CONSOLE_PATHS.intent(intent.id)}>
                    <span className={consoleMono}>#{intent.id}</span> {describeAction(intent.action)}
                  </Link>
                  <span className={consoleSub}>
                    {intent.agent} · {intent.verdicts?.find((v) => v.verdict === "defer")?.reason ?? "deferred"}
                  </span>
                </span>
                <ConsoleIntentSteps intent={intent} />
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>
    </>
  );
}
