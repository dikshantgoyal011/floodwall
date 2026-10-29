import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

declare global {
  interface Window {
    floodwallTheme: { get(): Theme; set(theme: Theme): void };
  }
}

const subscribe = (notify: () => void) => {
  window.addEventListener("floodwall:theme-change", notify);
  return () => window.removeEventListener("floodwall:theme-change", notify);
};
const snapshot = () => window.floodwallTheme.get();

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, snapshot);
  return { theme, toggleTheme: () => window.floodwallTheme.set(theme === "dark" ? "light" : "dark") };
}
