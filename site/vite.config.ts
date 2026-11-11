import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { readCrateFacts, readCrateStats } from "./crate-stats.mjs";
import { scopeLandingCss } from "./scope-landing-css.mjs";
import { PAGE_TITLE, headTags } from "./structured-data.mjs";
import { EARLY_ACCESS_URL } from "./src/constants/links";

const crateRoot = path.resolve(__dirname, "..");

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

/** A policy for the static page; GitHub Pages sets no headers, so it ships as a meta tag. */
function contentSecurityPolicy(html: string) {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${inline.join(" ")}`,
    // theme.js and the hairline kernel each insert a <style> element.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

// Link-preview and search metadata, built from the crate's Cargo.toml facts, and the early-access URL.
const structuredDataPlugin = (): Plugin => ({
  name: "floodwall-structured-data",
  transformIndexHtml(html, { filename, server }) {
    if (path.basename(filename) !== "index.html") return html;
    if (!html.includes(`<title>${PAGE_TITLE}</title>`)) throw new Error("index.html <title> must match PAGE_TITLE in structured-data.mjs");
    // The noscript fallback links the same form as the waitlist section.
    if (!html.includes("%EARLY_ACCESS_URL%")) throw new Error("index.html must link its noscript note to %EARLY_ACCESS_URL%");
    if (!html.includes("%HAIRLINE_VERSION%")) throw new Error("index.html must version its /hairline scripts with %HAIRLINE_VERSION%");
    const tags = headTags(readCrateFacts(crateRoot));
    // The built page allows only its own scripts and its inline scripts by hash, and its own styles and fonts.
    // Skipped in dev, where Vite injects inline scripts of its own.
    if (!server) tags.unshift({ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(html) }, injectTo: "head-prepend" });
    html = html.replaceAll("%EARLY_ACCESS_URL%", EARLY_ACCESS_URL).replaceAll("%HAIRLINE_VERSION%", HAIRLINE_VERSION);
    return { html, tags };
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), structuredDataPlugin()],
  publicDir: "public",
  css: {
    postcss: { plugins: [scopeLandingCss(/[\\/]src[\\/]styles[\\/]landing[\\/]/)] },
  },
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
});
