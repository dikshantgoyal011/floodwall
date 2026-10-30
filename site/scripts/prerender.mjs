// Write the server-rendered page into the built index.html, so its content is in the HTML
// before any script runs. Run after `vite build` and `vite build --ssr src/entry-server.tsx`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = path.resolve(site, "../docs/index.html");
const server = path.join(site, ".ssr/entry-server.js");

const { render } = await import(pathToFileURL(server).href);
const html = fs.readFileSync(page, "utf8");
const empty = '<div id="root"></div>';
if (html.split(empty).length !== 2) throw new Error(`${page} must contain exactly one empty ${empty}`);
// A replacer function, so `$&`-style patterns in the rendered page are written literally.
fs.writeFileSync(page, html.replace(empty, () => `<div id="root">${render()}</div>`));
fs.rmSync(path.join(site, ".ssr"), { recursive: true, force: true });
