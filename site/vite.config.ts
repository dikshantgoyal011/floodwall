import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { readCrateFacts, readCrateStats } from "./crate-stats.mjs";
import { PAGE_TITLE, headTags } from "./structured-data.mjs";

const crateRoot = path.resolve(__dirname, "..");

/** The sign-in service (api/), which the site calls once it is built with VITE_AUTH_API_URL. */
const AUTH_API_ORIGIN = "https://api.floodwall.ai";
/** Inter and Instrument Serif, for the pricing, sign-in and console pages. */
const GOOGLE_FONTS = { styles: "https://fonts.googleapis.com", files: "https://fonts.gstatic.com" };

/**
 * A content hash of public/hairline, the diagram scripts served outside the hashed bundle. Their
 * URLs carry it, so a cached old figure never runs against a newly deployed app.
 */
function hairlineVersion() {
  const dir = path.resolve(__dirname, "public/hairline");
  const hash = createHash("sha256");
  for (const name of readdirSync(dir).sort()) hash.update(name).update(readFileSync(path.join(dir, name)));
  return hash.digest("hex").slice(0, 10);
}
const HAIRLINE_VERSION = hairlineVersion();

/**
 * A policy for the static page; GitHub Pages sets no headers, so it ships as a meta tag. `api` is
 * the sign-in service's origin the build points at, if it isn't api.floodwall.ai (a local one).
 */
function contentSecurityPolicy(html: string, api: string | undefined) {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  const connect = new Set(["'self'", AUTH_API_ORIGIN, ...(api ? [api] : [])]);
  return [
    "default-src 'self'",
    `script-src 'self' ${inline.join(" ")}`,
    // theme.js and the hairline kernel each insert a <style> element.
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS.styles}`,
    `font-src 'self' ${GOOGLE_FONTS.files}`,
    "img-src 'self' data:",
    `connect-src ${[...connect].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** The origin of VITE_AUTH_API_URL, or undefined when the site runs its in-browser demo. */
function authApiOrigin(mode: string) {
  const url = loadEnv(mode, __dirname, "VITE_").VITE_AUTH_API_URL;
  return url ? new URL(url).origin : undefined;
}

// Link-preview and search metadata, built from the crate's Cargo.toml facts.
const structuredDataPlugin = (api: string | undefined): Plugin => ({
  name: "floodwall-structured-data",
  transformIndexHtml(html, { filename, server }) {
    if (path.basename(filename) !== "index.html") return html;
    if (!html.includes(`<title>${PAGE_TITLE}</title>`)) throw new Error("index.html <title> must match PAGE_TITLE in structured-data.mjs");
    if (!html.includes("%HAIRLINE_VERSION%")) throw new Error("index.html must version its /hairline scripts with %HAIRLINE_VERSION%");
    const tags = headTags(readCrateFacts(crateRoot));
    // The built page allows only its own scripts and its inline scripts by hash, and talks only to
    // itself and the sign-in service. Skipped in dev, where Vite injects inline scripts of its own.
    if (!server) tags.unshift({ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(html, api) }, injectTo: "head-prepend" });
    html = html.replaceAll("%HAIRLINE_VERSION%", HAIRLINE_VERSION);
    return { html, tags };
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), structuredDataPlugin(authApiOrigin(mode))],
  publicDir: "public",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  define: {
    // Throws, failing the build, if Cargo.toml cannot be parsed.
    __CRATE_STATS__: JSON.stringify(readCrateStats(crateRoot)),
    __HAIRLINE_VERSION__: JSON.stringify(HAIRLINE_VERSION),
  },
  build: {
    outDir: path.resolve(__dirname, "../docs"),
    emptyOutDir: true,
  },
}));
