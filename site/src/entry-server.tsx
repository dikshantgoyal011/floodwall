import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { routes } from "./router";

/** A page's HTML at build time; scripts/build.mjs writes the landing page's into #root for main.tsx to hydrate. */
export async function render(path: string) {
  const { query, dataRoutes } = createStaticHandler(routes);
  const context = await query(new Request(new URL(path, "https://floodwall.ai")));
  if (context instanceof Response) throw new Error(`${path} redirects; only a page that renders can be prerendered`);
  // hydrate={false}: no inline hydration script, which the page's CSP would block. The routes have
  // no loaders, so the browser router has nothing to hydrate from it.
  return renderToString(
    <StrictMode>
      <StaticRouterProvider router={createStaticRouter(dataRoutes, context)} context={context} hydrate={false} />
    </StrictMode>,
  );
}
