// Guards for the two rules the site ships under:
//
//   1. The public landing page at floodwall.ai stays as users see it. Its
//      built files are not byte-stable (the hero stats follow the crate),
//      so the guard watches its sources instead: a pull request that
//      changes one fails unless it carries the landing-change-approved
//      label, which a maintainer adds once the change is signed off.
//   2. The console lives apart under /console/ and stays out of search:
//      its HTML carries a robots noindex tag in the static file, the
//      landing page carries none and loads nothing of the console's, and
//      the sitemap does not list it.
//
//   node tools/site-guard.mjs built [DOCS_DIR]
//       checks the built site (default: docs/ at the repo root).
//   node tools/site-guard.mjs landing --base REV [--head REV]
//       checks the landing sources changed between REV and HEAD_REV (from
//       their merge base, as a pull request shows them) or, without
//       --head, between REV and the working tree, untracked files
//       included. PR_LABELS holds the pull request's labels as a JSON
//       array of names.
//
// Exit status: 0 when the rules hold, 1 when one is broken, 2 on bad
// usage. Node's standard library only, like verify-ledger.mjs.
//
// This lives outside site/ on purpose: Tailwind scans every file there for
// class names, so the words in this file would add utilities to the
// landing page's CSS.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The label that lets a pull request change the landing page. */
export const APPROVAL_LABEL = "landing-change-approved";

/**
 * The landing page's sources, relative to the repo root. An entry ending in
 * `/` covers everything under that directory.
 */
export const LANDING_SOURCES = [
  "site/index.html",
  "site/src/main.tsx",
  "site/src/App.tsx",
  "site/src/landing/",
  "site/src/sections/",
  "site/src/styles/",
  "site/src/components/",
  "site/src/content.ts",
  "site/src/hooks.ts",
  "site/crate-stats.mjs",
  "site/vite.config.ts",
  "site/public/",
];

const ROBOTS_NAMES = new Set(["robots", "googlebot", "bingbot"]);
const TEXT_FILES = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".map", ".xml", ".txt", ".svg", ".webmanifest"]);
const URL_ATTRIBUTES = new Set(["src", "href", "srcset", "poster", "data"]);
const SITE = "https://floodwall.ai/";

/**
 * The landing sources among `paths` (repo-relative, either separator),
 * sorted and without duplicates.
 * @param {string[]} paths
 */
export function landingChanges(paths) {
  const hits = paths
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => LANDING_SOURCES.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s)));
  return [...new Set(hits)].sort();
}

/**
 * Rule 1 for one pull request.
 * @param {{changed: string[], labels: string[]}} pr
 */
export function checkLanding({ changed, labels }) {
  const hits = landingChanges(changed);
  const list = hits.map((p) => `  ${p}`).join("\n");
  if (hits.length === 0) return { errors: [], notices: ["no landing-page sources changed"] };
  if (labels.includes(APPROVAL_LABEL)) {
    return { errors: [], notices: [`landing-page sources changed, approved by the ${APPROVAL_LABEL} label:\n${list}`] };
  }
  return {
    errors: [
      `these changes touch the public landing page, which must stay as users see it today:\n${list}\n` +
        `If the CEO has signed off on the change, ask a maintainer to add the ${APPROVAL_LABEL} label; ` +
        "this check runs again when it is added. Otherwise, leave these files as they are on the base branch.",
    ],
    notices: [],
  };
}

/**
 * The files a change touches, repo-relative. With `head`, those changed on
 * `head` since it left `base`; without, those that differ between `base`
 * and the working tree, untracked files included. Renames count as a
 * deletion plus an addition, so a file moved out of a landing directory
 * still counts.
 * @param {string} repo
 * @param {string} base
 * @param {string | undefined} head
 */
export function changedFiles(repo, base, head) {
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const names = (out) => out.split("\0").filter(Boolean);
  if (head) return names(git("diff", "--name-only", "--no-renames", "-z", `${base}...${head}`));
  const since = git("merge-base", base, "HEAD").trim();
  return [
    ...names(git("diff", "--name-only", "--no-renames", "-z", since)),
    ...names(git("ls-files", "--others", "--exclude-standard", "-z")),
  ];
}

/**
 * Every `<meta>` tag's attributes (names lower-cased), skipping comments
 * and the contents of scripts and other raw-text elements: a tag written
 * by JavaScript is not in the static HTML.
 * @param {string} html
 * @returns {Record<string, string>[]}
 */
export function metaTags(html) {
  const plain = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|textarea|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  return [...plain.matchAll(/<meta\b([^>]*)>/gi)].map((m) => attributes(m[1]));
}

/** @param {string} source @returns {Record<string, string>} */
function attributes(source) {
  const out = {};
  for (const m of source.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/**
 * The robots directives a page's meta tags give the crawlers named in
 * `names`, lower-cased. `none` is spelled out as `noindex` and `nofollow`.
 * @param {string} html
 * @param {Set<string>} names
 */
export function robotsDirectives(html, names = ROBOTS_NAMES) {
  const out = new Set();
  for (const tag of metaTags(html)) {
    if (!names.has((tag.name ?? "").toLowerCase())) continue;
    for (const word of (tag.content ?? "").split(",")) {
      const d = word.trim().toLowerCase();
      if (d === "none") out.add("noindex").add("nofollow");
      else if (d) out.add(d);
    }
  }
  return out;
}

/**
 * The URLs a page's tags point at that land under /console/ on the site.
 * @param {string} html
 */
function consoleReferences(html) {
  const plain = html.replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  for (const tag of plain.matchAll(/<[a-z][^\s>]*\b([^>]*)>/gi)) {
    for (const [name, value] of Object.entries(attributes(tag[1]))) {
      if (!URL_ATTRIBUTES.has(name)) continue;
      const urls = name === "srcset" ? value.split(",").map((c) => c.trim().split(/\s+/)[0]) : [value];
      for (const url of urls) if (url && isConsoleUrl(url)) out.push(url);
    }
  }
  return out;
}

/** @param {string} url */
function isConsoleUrl(url) {
  let parsed;
  try {
    parsed = new URL(url, SITE);
  } catch {
    return false;
  }
  const ours = parsed.hostname === "floodwall.ai" || parsed.hostname === "www.floodwall.ai";
  return ours && (parsed.pathname === "/console" || parsed.pathname.startsWith("/console/"));
}

/** @param {string} dir @returns {string[]} paths relative to `dir`, with `/` */
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return files(path.join(dir, entry.name)).map((f) => `${entry.name}/${f}`);
    return [entry.name];
  });
}

/**
 * Rule 2, and rule 1's part of the built output, for the site built into
 * `docsDir`.
 * @param {string} docsDir
 */
export function checkBuiltSite(docsDir) {
  const errors = [];
  const notices = [];
  const read = (rel) => fs.readFileSync(path.join(docsDir, rel), "utf8");
  const exists = (rel) => fs.existsSync(path.join(docsDir, rel));

  if (!exists("index.html")) {
    errors.push("docs/index.html is missing: the landing page was not built");
  } else {
    const landing = read("index.html");
    if (robotsDirectives(landing).has("noindex")) {
      errors.push("docs/index.html carries a robots noindex tag: search engines would drop the landing page");
    }
    for (const url of consoleReferences(landing)) {
      errors.push(`docs/index.html refers to the console (${url}): the landing page must not load or link it`);
    }
  }

  if (!exists("sitemap.xml")) {
    errors.push("docs/sitemap.xml is missing: the landing page ships one");
  } else {
    for (const m of read("sitemap.xml").matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)) {
      if (isConsoleUrl(m[1])) errors.push(`docs/sitemap.xml lists a console URL (${m[1]}): the console stays out of search`);
    }
  }

  const all = files(docsDir);
  for (const rel of all) {
    if (rel.startsWith("console/") || !TEXT_FILES.has(path.extname(rel).toLowerCase())) continue;
    if (read(rel).includes("console/assets/")) {
      errors.push(`docs/${rel} refers to console/assets/: only the console's own files may load them`);
    }
  }

  if (!exists("console")) {
    notices.push("docs/console/ is not built yet: the console checks were skipped");
  } else {
    if (!exists("console/index.html")) errors.push("docs/console/index.html is missing: the console was not built");
    for (const rel of all.filter((f) => f.startsWith("console/") && /\.html?$/i.test(f))) {
      const head = read(rel).match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
      const robots = robotsDirectives(head, new Set(["robots"]));
      if (!robots.has("noindex") || !robots.has("nofollow")) {
        errors.push(
          `docs/${rel} has no <meta name="robots" content="noindex, nofollow"> in its static <head>: ` +
            "search engines could index the console",
        );
      }
    }
  }
  return { errors, notices };
}

/** @param {{errors: string[], notices: string[]}} result @param {string} passed */
function report({ errors, notices }, passed) {
  for (const n of notices) console.log(`note: ${n}`);
  for (const e of errors) {
    console.error(`error: ${e}`);
    if (process.env.GITHUB_ACTIONS === "true") console.error(`::error::${e.split("\n")[0]}`);
  }
  if (errors.length === 0) console.log(`ok: ${passed}`);
  return errors.length === 0 ? 0 : 1;
}

/** @param {string} raw */
function parseLabels(raw) {
  if (raw === undefined || raw === "") return [];
  let labels;
  try {
    labels = JSON.parse(raw);
  } catch {
    labels = null;
  }
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === "string")) {
    throw new Error(`PR_LABELS must be a JSON array of label names, not ${raw}`);
  }
  return labels;
}

function usage() {
  console.error("usage: node tools/site-guard.mjs built [DOCS_DIR]\n       node tools/site-guard.mjs landing --base REV [--head REV]");
  return 2;
}

/** @param {string[]} args */
function main(args) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...rest] = args;
  if (command === "built" && rest.length <= 1) {
    const dir = rest[0] ? path.resolve(rest[0]) : path.join(repo, "docs");
    return report(checkBuiltSite(dir), "the built site keeps the landing page as it is and the console out of search");
  }
  if (command === "landing") {
    const opts = {};
    for (let i = 0; i < rest.length; i += 2) {
      if (!["--base", "--head"].includes(rest[i]) || !rest[i + 1] || rest[i] in opts) return usage();
      opts[rest[i]] = rest[i + 1];
    }
    if (!opts["--base"]) return usage();
    let labels, changed;
    try {
      labels = parseLabels(process.env.PR_LABELS);
      changed = changedFiles(repo, opts["--base"], opts["--head"]);
    } catch (e) {
      console.error(`error: ${e.message.trim()}`);
      return 2;
    }
    const passed = landingChanges(changed).length ? "the landing-page changes are approved" : "the landing page's sources are as they were";
    return report(checkLanding({ changed, labels }), passed);
  }
  return usage();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
