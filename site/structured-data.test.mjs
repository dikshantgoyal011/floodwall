import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { packageField, readCrateFacts } from "./crate-stats.mjs";
import { PAGE_DESCRIPTION, PAGE_TITLE, SHARE_IMAGE, SITE_URL, headTags, inlineJson, structuredData } from "./structured-data.mjs";

const crate = readCrateFacts(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const graph = structuredData(crate)["@graph"];
const node = (type) => graph.find((n) => n["@type"] === type);

test("package fields read strings and single-line arrays, and reject anything else", () => {
  const toml = '[package]\nname = "floodwall"\nkeywords = ["a", "b-c"]\nlicense = { workspace = true }\n';
  assert.equal(packageField(toml, "name"), "floodwall");
  assert.deepEqual(packageField(toml, "keywords"), ["a", "b-c"]);
  assert.throws(() => packageField(toml, "license"), /unsupported/);
  assert.throws(() => packageField(toml, "description"), /no description/);
});

test("the software node states the crate's own Cargo facts", () => {
  const software = node("SoftwareSourceCode");
  assert.equal(software.version, crate.release);
  assert.equal(software.codeRepository, crate.repository);
  assert.equal(software.license, `https://spdx.org/licenses/${crate.license}.html`);
  assert.equal(software.description, crate.description);
});

test("every @id reference resolves inside the graph", () => {
  const ids = new Set(graph.map((n) => n["@id"]));
  const refs = JSON.stringify(graph).matchAll(/\{"@id":"([^"]+)"\}/g);
  for (const [, ref] of refs) assert.ok(ids.has(ref), `dangling reference ${ref}`);
});

test("a licence expression is refused rather than linked wrongly", () => {
  assert.throws(() => structuredData({ ...crate, license: "MIT OR Apache-2.0" }), /licence expression/);
});

test("inline JSON cannot close its script element", () => {
  assert.equal(inlineJson({ a: "</script>" }), '{"a":"\\u003c/script>"}');
});

test("the share image is absolute and 1200x630 in every tag that names it", () => {
  const tags = headTags(crate);
  const content = (key) => tags.find((t) => t.attrs.property === key || t.attrs.name === key)?.attrs.content;
  assert.ok(SHARE_IMAGE.url.startsWith(SITE_URL));
  assert.equal(content("og:image"), SHARE_IMAGE.url);
  assert.equal(content("twitter:image"), SHARE_IMAGE.url);
  assert.equal(content("og:image:width"), "1200");
  assert.equal(content("og:image:height"), "630");
  assert.equal(content("twitter:card"), "summary_large_image");
});

test("the description fits a search snippet without being cut", () => {
  assert.ok(PAGE_DESCRIPTION.length >= 120 && PAGE_DESCRIPTION.length <= 160, `${PAGE_DESCRIPTION.length} characters`);
});

test("the web manifest describes the page as the meta description does", () => {
  const manifest = JSON.parse(readFileSync(new URL("./public/site.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.description, PAGE_DESCRIPTION);
  assert.ok(PAGE_TITLE.startsWith(`${manifest.name} |`));
});
