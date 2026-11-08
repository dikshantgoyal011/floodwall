import { useSyncExternalStore } from "react";

const staticSubscribe = () => () => {};

/** A value only the browser knows and that never changes during the visit, such as the URL's query. */
export function useClientValue<T>(read: () => T, serverValue: T) {
  return useSyncExternalStore(staticSubscribe, read, () => serverValue);
}
