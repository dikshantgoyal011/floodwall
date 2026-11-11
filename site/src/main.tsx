import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { RouterProvider } from "react-router";
import { router } from "./router";
import "./index.css";
import "./styles/landing/theme.css";
import "./styles/landing/header.css";
import "./styles/landing/hero.css";
import "./styles/landing/sections.css";
import "./styles/landing/footer.css";
import "./styles/landing/pricing.css";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    {/* Motion components follow the OS reduced-motion setting: travel drops, fades stay. */}
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  </StrictMode>
);

// The build prerenders the landing page into index.html's #root (scripts/build.mjs). Every other
// route, served from 404.html, and the dev server start from an empty #root. Only "/" hydrates: a
// host that answered another path with the prerendered index.html is rendered afresh instead.
if (root.hasChildNodes() && location.pathname === "/") hydrateRoot(root, app);
else {
  root.replaceChildren();
  createRoot(root).render(app);
}
