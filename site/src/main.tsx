import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./styles/theme.css";
import "./styles/header.css";
import "./styles/hero.css";
import "./styles/sections.css";
import "./styles/footer.css";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The build prerenders the page into #root (scripts/prerender.mjs); the dev server serves it empty.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
