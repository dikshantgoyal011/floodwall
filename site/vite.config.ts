import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { readCrateFacts, readCrateStats } from "./crate-stats.mjs";
import { PAGE_TITLE, headTags } from "./structured-data.mjs";

const crateRoot = path.resolve(__dirname, "..");

// Link-preview and search metadata, built from the crate's Cargo.toml facts.
const structuredDataPlugin = (): Plugin => ({
  name: "floodwall-structured-data",
  transformIndexHtml(html, { filename }) {
    if (path.basename(filename) !== "index.html") return html;
    if (!html.includes(`<title>${PAGE_TITLE}</title>`)) throw new Error("index.html <title> must match PAGE_TITLE in structured-data.mjs");
    return { html, tags: headTags(readCrateFacts(crateRoot)) };
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), structuredDataPlugin()],
  publicDir: "public",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  define: {
    // Throws, failing the build, if Cargo.toml cannot be parsed.
    __CRATE_STATS__: JSON.stringify(readCrateStats(crateRoot)),
  },
  build: {
    outDir: path.resolve(__dirname, "../docs"),
    emptyOutDir: true,
  },
});
