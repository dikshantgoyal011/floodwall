import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";

/**
 * The landing page's HTML at build time; scripts/build.mjs writes it into index.html's #root for
 * main.tsx to hydrate. The landing page uses no router hooks, so it renders without the router.
 */
export function render() {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
