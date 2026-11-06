// Build the site into docs/ (or `--outDir DIR`, as the preview workflow passes), then prerender the
// landing page into its index.html, so its content is in the HTML before any script runs.
//   node scripts/build.mjs [--outDir DIR]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--outDir");
const outDir = path.resolve(flag === -1 ? path.join(site, "../docs") : process.argv[flag + 1]);
const ssrDir = path.join(site, ".ssr");

await build({ root: site, build: { outDir, emptyOutDir: true } });
await build({
  root: site,
  logLevel: "warn",
  build: { ssr: "src/entry-server.tsx", outDir: ssrDir, emptyOutDir: true },
});

const { render } = await import(pathToFileURL(path.join(ssrDir, "entry-server.js")).href);
const page = path.join(outDir, "index.html");
const html = fs.readFileSync(page, "utf8");
const empty = '<div id="root"></div>';
if (html.split(empty).length !== 2) throw new Error(`${page} must contain exactly one empty ${empty}`);

// GitHub Pages answers every other path (/pricing, /login, /app/...) with 404.html, which the app
// renders in the browser; it stays empty so those pages never flash the landing page first.
fs.writeFileSync(path.join(outDir, "404.html"), html);
const landing = await render("/");
// A replacer function, so `$&`-style patterns in the rendered page are written literally.
fs.writeFileSync(page, html.replace(empty, () => `<div id="root">${landing}</div>`));
fs.rmSync(ssrDir, { recursive: true, force: true });
