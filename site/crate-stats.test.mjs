import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  countDependencies,
  countTests,
  displayVersion,
  parseCrateVersion,
  readCrateStats,
} from "./crate-stats.mjs";

const pkg = (version, rest = "") => `[package]\nname = "floodwall"\nversion = ${version}\nedition = "2021"\n${rest}`;
const shown = (toml) => displayVersion(parseCrateVersion(toml));

test("a release shows major.minor", () => {
  assert.equal(shown(pkg('"0.1.0"')), "0.1");
  assert.equal(shown(pkg('"12.30.4"')), "12.30");
});

test("a prerelease is shown in full, never as the release", () => {
  // Review repro on PR #10: this used to fall back to "0.1".
  assert.equal(shown(pkg('"0.2.0-beta.1"')), "0.2.0-beta.1");
  assert.equal(shown(pkg('"1.0.0-alpha"')), "1.0.0-alpha");
});

test("build metadata parses and is not shown", () => {
  assert.equal(shown(pkg('"1.4.2+build.7"')), "1.4");
  assert.equal(shown(pkg('"0.2.0-rc.1+sha.5114f85"')), "0.2.0-rc.1");
  assert.deepEqual(parseCrateVersion(pkg('"0.2.0-rc.1+sha.5114f85"')), {
    major: 0,
    minor: 2,
    patch: 0,
    prerelease: "rc.1",
    build: "sha.5114f85",
  });
});

test("a trailing comment after the version is fine", () => {
  assert.equal(shown(pkg('"0.3.1" # bump on release')), "0.3");
});

test("malformed versions fail instead of falling back", () => {
  for (const bad of ['"0.2"', '"1.2.3.4"', '"01.2.3"', '"v1.2.3"', '"0.2.0-"', '"0.2.0+"', '"0.2.0-beta..1"', '""', "0.2.0"]) {
    assert.throws(() => parseCrateVersion(pkg(bad)), /not valid SemVer|unsupported/, bad);
  }
});

test("a missing or inherited version fails", () => {
  assert.throws(() => parseCrateVersion('[package]\nname = "x"\n'), /has no version/);
  assert.throws(() => parseCrateVersion('version = "1.0.0"\n'), /no \[package\] table/);
  assert.throws(() => parseCrateVersion('[package]\nversion.workspace = true\n'), /unsupported/);
});

test("only [package] version counts, not a dependency's", () => {
  const toml = '[dependencies.serde]\nversion = "9.9.9"\n\n[package]\nname = "x"\nversion = "0.4.0"\n';
  assert.equal(shown(toml), "0.4");
});

test("dependencies: inline keys and [dependencies.<name>] tables", () => {
  assert.equal(countDependencies(pkg('"0.1.0"', "\n[dependencies]\n\n[dev-dependencies]\nproptest = \"1\"\n")), 0);
  const toml = pkg('"0.1.0"', '\n[dependencies]\nserde = "1"\nrand = { version = "0.8" } # rng\n\n[dependencies.tokio]\nversion = "1"\nfeatures = ["rt"]\n');
  assert.equal(countDependencies(toml), 3);
});

test("tests: #[test] plus runnable doc blocks, closing fences not counted", () => {
  const src = [
    "//! ```text",
    "//! diagram",
    "//! ```",
    "//! ```",
    "//! assert!(true);",
    "//! ```",
    "/// ```rust",
    "/// assert!(true);",
    "/// ```",
    "/// ```ignore",
    "/// nope();",
    "/// ```",
    "#[test]",
    "fn a() {}",
    "#[test]",
    "fn b() {}",
  ].join("\r\n");
  assert.equal(countTests(src), 4);
});

test("the real crate parses", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const stats = readCrateStats(root);
  assert.match(stats.version, /^\d+\.\d+/);
  assert.equal(stats.dependencies, 0);
  assert.ok(stats.tests > 0);
});
