import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "./router";
import "./index.css";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>
);

// The build prerenders the landing page into index.html (scripts/build.mjs). Every other page, and
// the dev server, starts from an empty #root; so does "/" if it was ever served something else.
if (root.hasChildNodes() && location.pathname === "/") hydrateRoot(root, app);
else {
  root.replaceChildren();
  createRoot(root).render(app);
}
