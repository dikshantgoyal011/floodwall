import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";

/** The page's HTML at build time; scripts/prerender.mjs writes it into #root for main.tsx to hydrate. */
export function render() {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
