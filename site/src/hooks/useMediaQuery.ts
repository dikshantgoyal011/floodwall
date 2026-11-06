import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query's live result. The prerendered HTML and the hydrating render use `serverValue`;
 * React then re-renders with the browser's answer.
 */
export function useMediaQuery(query: string, serverValue = false) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}
