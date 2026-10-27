import { createContext, useContext, type Dispatch } from "react";
import type { IntentDraft, PlaneEvent, PlaneState } from "../types/console";

export type Plane = {
  state: PlaneState;
  dispatch: Dispatch<PlaneEvent>;
  /** Queues an intent and returns the id it was given. */
  submit: (intent: IntentDraft) => number;
};

/** Filled in by <PlaneProvider> in ConsoleLayout. */
export const PlaneContext = createContext<Plane | null>(null);

/** The console's plane state and the events that change it. */
export function usePlane() {
  const plane = useContext(PlaneContext);
  if (!plane) throw new Error("usePlane must be used inside <PlaneProvider>");
  return plane;
}
