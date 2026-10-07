import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readCrateStats } from "./crate-stats.mjs";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: "public",
  define: {
    // Throws, failing the build, if Cargo.toml cannot be parsed.
    __CRATE_STATS__: JSON.stringify(readCrateStats(path.resolve(__dirname, ".."))),
  },
  build: {
    outDir: path.resolve(__dirname, "../docs"),
    emptyOutDir: true,
  },
});
