import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeLandingCss, scopeSelector, splitSelectors } from "./scope-landing-css.mjs";

test("splits on top-level commas only", () => {
  assert.deepEqual(splitSelectors("a, b"), ["a", "b"]);
  assert.deepEqual(splitSelectors(":is(a, b) > c, d"), [":is(a, b) > c", "d"]);
  assert.deepEqual(splitSelectors('[data-x="a,b"], e'), ['[data-x="a,b"]', "e"]);
});

test(":root rules move onto the scope element", () => {
  assert.equal(scopeSelector(":root"), ".fw-site");
  assert.equal(scopeSelector(':root[data-theme="dark"]'), '.fw-site[data-theme="dark"]');
  assert.equal(scopeSelector(':root[data-count-up="pending"] .count-up'), '.fw-site[data-count-up="pending"] .count-up');
});

test("html rules apply only when <html> is the scope", () => {
  assert.equal(scopeSelector("html"), "html.fw-site");
  assert.equal(scopeSelector("html:focus-within"), "html.fw-site:focus-within");
});

test("body rules also reach a scope box that is not <html>", () => {
  assert.equal(scopeSelector("body"), ".fw-site body, .fw-site:not(html)");
});

test("everything else must sit inside the scope", () => {
  assert.equal(scopeSelector("main > section"), ".fw-site main > section");
  assert.equal(scopeSelector("*::before"), ".fw-site *::before");
  assert.equal(scopeSelector("::selection"), ".fw-site ::selection");
  // Names that merely start like the special ones are ordinary selectors.
  assert.equal(scopeSelector("html-ish"), ".fw-site html-ish");
  assert.equal(scopeSelector(".body"), ".fw-site .body");
});

test("the plugin scopes matching files and leaves keyframes and other files alone", () => {
  const rule = (selector, parent) => ({ selector, parent });
  const keyframes = { type: "atrule", name: "keyframes" };
  const rules = [rule("a, :root", undefined), rule("from", keyframes)];
  const sheet = (file) => ({ source: { input: { file } }, walkRules: (visit) => rules.forEach(visit) });

  scopeLandingCss(/landing/).Once(sheet("/site/src/index.css"));
  assert.equal(rules[0].selector, "a, :root");

  scopeLandingCss(/landing/).Once(sheet("/site/src/styles/landing/theme.css"));
  assert.equal(rules[0].selector, ".fw-site a,\n.fw-site");
  assert.equal(rules[1].selector, "from");
});
