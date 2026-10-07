// Facts about the floodwall crate shown in the site's hero, read at build
// time by vite.config.ts. Every parser here throws on input it does not
// understand, so the build fails instead of publishing a plausible but
// wrong number.

import fs from "node:fs";
import path from "node:path";

// The SemVer 2.0.0 grammar (https://semver.org), which is what Cargo accepts.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Split a Cargo.toml into its tables: header name -> body lines. Keys
 * before the first header go under "". Only what this module needs:
 * `[table]` headers and `key = value` lines, comments stripped.
 * @param {string} toml
 * @returns {Map<string, string[]>}
 */
function tables(toml) {
  const out = new Map([["", []]]);
  let current = "";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      current = header[1];
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    out.get(current).push(line);
  }
  return out;
}

/**
 * Parse `[package] version` from a Cargo.toml.
 * @param {string} toml
 * @returns {{major: number, minor: number, patch: number, prerelease: string | null, build: string | null}}
 */
export function parseCrateVersion(toml) {
  const pkg = tables(toml).get("package");
  if (!pkg) throw new Error("Cargo.toml has no [package] table");
  const entry = pkg.find((line) => /^version\s*[.=]/.test(line));
  if (!entry) throw new Error("Cargo.toml [package] has no version");
  const quoted = entry.match(/^version\s*=\s*"([^"]*)"$/);
  if (!quoted) {
    throw new Error(`unsupported Cargo.toml version entry: ${entry} (expected version = "MAJOR.MINOR.PATCH")`);
  }
  const m = quoted[1].match(SEMVER);
  if (!m) throw new Error(`Cargo.toml version "${quoted[1]}" is not valid SemVer`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
  };
}

/**
 * How the hero shows a version: `0.1` for a release, the full version for a
 * prerelease (so a beta is never presented as the shipped release). Build
 * metadata is dropped, as SemVer says it carries no precedence.
 * @param {ReturnType<typeof parseCrateVersion>} v
 */
export function displayVersion(v) {
  return v.prerelease
    ? `${v.major}.${v.minor}.${v.patch}-${v.prerelease}`
    : `${v.major}.${v.minor}`;
}

/**
 * Count runtime dependencies: keys under `[dependencies]` plus
 * `[dependencies.<name>]` tables.
 * @param {string} toml
 */
export function countDependencies(toml) {
  let count = 0;
  for (const [name, lines] of tables(toml)) {
    if (name === "dependencies") count += lines.filter((l) => /^[A-Za-z0-9_-]+\s*=/.test(l)).length;
    else if (name.startsWith("dependencies.")) count += 1;
  }
  return count;
}

/**
 * Count `#[test]` functions plus doc-comment code blocks rustdoc runs
 * (untagged or `rust`; `text`, `ignore` and other tags do not run).
 * @param {string} source
 */
export function countTests(source) {
  let tests = (source.match(/#\[test\]/g) ?? []).length;
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    const fence = line.match(/^\s*\/\/[/!]\s*```(\S*)/);
    if (!fence) continue;
    if (!inBlock && (fence[1] === "" || fence[1] === "rust")) tests += 1;
    inBlock = !inBlock;
  }
  return tests;
}

/** @param {string} dir @returns {string[]} */
function rustFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return rustFiles(full);
    return entry.name.endsWith(".rs") ? [full] : [];
  });
}

/**
 * Read the hero's stats from the crate rooted at `crateRoot`.
 * @param {string} crateRoot
 */
export function readCrateStats(crateRoot) {
  const toml = fs.readFileSync(path.join(crateRoot, "Cargo.toml"), "utf8");
  return {
    version: displayVersion(parseCrateVersion(toml)),
    dependencies: countDependencies(toml),
    tests: rustFiles(path.join(crateRoot, "src")).reduce(
      (sum, file) => sum + countTests(fs.readFileSync(file, "utf8")),
      0,
    ),
  };
}
