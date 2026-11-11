// Build the site and prerender the landing page: `node scripts/build.mjs [--outDir <dir>]`.
// vite.config.ts builds into ../docs; --outDir (relative to site/) builds elsewhere, as the preview
// workflow does. Writes:
// - index.html, the landing page rendered into #root, so its content is in the HTML before any
//   script runs; main.tsx hydrates it.
// - 404.html, the same page with #root left empty. GitHub Pages serves it for every other path
//   (/pricing, /login, /app/...), which the app then renders in the browser without first showing
//   the landing page.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { outDir: { type: "string" } } });
const outDir = values.outDir ? path.resolve(values.outDir) : path.resolve(site, "../docs");
const ssrDir = path.join(site, ".ssr");

await build({ root: site, build: { outDir, emptyOutDir: true } });
await build({ root: site, logLevel: "warn", build: { ssr: "src/entry-server.tsx", outDir: ssrDir, emptyOutDir: true } });

const page = path.join(outDir, "index.html");
const html = fs.readFileSync(page, "utf8");
const empty = '<div id="root"></div>';
if (html.split(empty).length !== 2) throw new Error(`${page} must contain exactly one empty ${empty}`);

const { render } = await import(pathToFileURL(path.join(ssrDir, "entry-server.js")).href);
fs.writeFileSync(path.join(outDir, "404.html"), html);
// A replacer function, so `$&`-style patterns in the rendered page are written literally.
fs.writeFileSync(page, html.replace(empty, () => `<div id="root">${render()}</div>`));
fs.rmSync(ssrDir, { recursive: true, force: true });
