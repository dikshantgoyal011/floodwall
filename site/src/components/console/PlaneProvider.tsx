import { useReducer, type ReactNode } from "react";
import { INITIAL_PLANE, nextIntentId, planeReducer } from "../../helpers/plane";
import { PlaneContext } from "../../hooks/usePlane";
import type { IntentDraft } from "../../types/console";

/** Holds the console's dummy plane in memory; a reload starts it over. */
export function PlaneProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(planeReducer, INITIAL_PLANE);
  // The one place a new intent's id is chosen, so the caller opens the intent it made.
  const submit = (intent: IntentDraft) => {
    const id = nextIntentId(state);
    dispatch({ type: "submit", id, intent });
    return id;
  };
  return <PlaneContext.Provider value={{ state, dispatch, submit }}>{children}</PlaneContext.Provider>;
}
