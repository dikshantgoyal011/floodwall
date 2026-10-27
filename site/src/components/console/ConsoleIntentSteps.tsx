import { INTENT_STEPS } from "../../constants/console";
import { usePlane } from "../../hooks/usePlane";
import { consoleActions } from "../../styles/classes";
import type { Intent } from "../../types/console";
import { ConsoleButton } from "./ConsoleButton";

/** The buttons that move `intent` to its next step, if it has one. */
export function ConsoleIntentSteps({ intent }: { intent: Intent }) {
  const { dispatch } = usePlane();
  const steps = INTENT_STEPS[intent.status];
  if (!steps) return null;

  return (
    <span className={consoleActions}>
      {steps.map(({ label, secondary, event }) => (
        <ConsoleButton
          key={label}
          variant={secondary ? "secondary" : "primary"}
          onClick={() => dispatch(event(intent.id))}
        >
          {label}
        </ConsoleButton>
      ))}
    </span>
  );
}
