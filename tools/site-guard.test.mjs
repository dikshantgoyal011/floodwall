import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { APPROVAL_LABEL, changedFiles, checkBuiltSite, checkLanding, landingChanges } from "./site-guard.mjs";

const script = fileURLToPath(new URL("./site-guard.mjs", import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "site-guard-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let trees = 0;
/** Write `files` (relative path -> contents) into a fresh directory. */
function tree(files) {
  const dir = path.join(scratch, `t${trees++}`);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

const LANDING =
  '<!doctype html><html><head><title>Floodwall</title><script type="module" src="/assets/index.js"></script>' +
  '<link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div></body></html>';
const ROBOTS = '<meta name="robots" content="noindex, nofollow" />';
const CONSOLE =
  `<!doctype html><html><head>${ROBOTS}<title>Floodwall Console</title>` +
  '<script type="module" src="/console/assets/console.js"></script></head><body><div id="root"></div></body></html>';
const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://floodwall.ai/</loc></url></urlset>';

/** A built site that keeps every rule, with `changes` applied (null removes a file). */
function site(changes = {}) {
  const files = {
    "index.html": LANDING,
    "assets/index.js": "console.log('landing')",
    "assets/index.css": "body{}",
    "sitemap.xml": SITEMAP,
    "robots.txt": "User-agent: *\nAllow: /\n",
    "hero.mp4": "video",
    "console/index.html": CONSOLE,
    "console/assets/console.js": "import('/console/assets/chunk.js')",
    ...changes,
  };
  return tree(Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)));
}

const errors = (changes) => checkBuiltSite(site(changes)).errors.join("\n");
const withLanding = (extra, at = "</head>") => ({ "index.html": LANDING.replace(at, `${extra}${at}`) });

test("a site that keeps every rule passes", () => {
  assert.deepEqual(checkBuiltSite(site()), { errors: [], notices: [] });
});

test("without docs/console/ yet, the console checks pass with a notice", () => {
  const result = checkBuiltSite(site({ "console/index.html": null, "console/assets/console.js": null }));
  assert.deepEqual(result.errors, []);
  assert.match(result.notices.join("\n"), /docs\/console\/ is not built yet/);
});

test("a noindex tag on the landing page fails, however it is written", () => {
  for (const tag of [
    '<meta name="robots" content="noindex">',
    '<meta content="noindex, follow" name="robots">',
    "<meta name='ROBOTS' content='NoIndex'>",
    '<meta name="googlebot" content="noindex">',
    '<meta name="robots" content="none">',
    '<meta\n  name="robots"\n  content="noindex"\n/>',
  ]) {
    assert.match(errors(withLanding(tag)), /docs\/index\.html carries a robots noindex tag/, tag);
  }
});

test("a robots tag that allows indexing, or a commented-out one, is fine on the landing page", () => {
  assert.equal(errors(withLanding('<meta name="robots" content="index, follow"><!-- <meta name="robots" content="noindex"> -->')), "");
});

test("the landing page loading or linking the console fails", () => {
  for (const tag of [
    '<script type="module" src="/console/assets/console.js"></script>',
    '<link rel="stylesheet" href="console/assets/console.css">',
    '<link rel="preload" href="https://floodwall.ai/console/chunk.js">',
    '<a href="/console/">Console</a>',
    '<img srcset="/img/a.png 1x, /console/b.png 2x">',
  ]) {
    assert.match(errors(withLanding(tag)), /docs\/index\.html refers to the console/, tag);
  }
});

test("links that only look like the console's are fine", () => {
  assert.equal(errors(withLanding('<a href="https://example.com/console/">x</a><a href="/consoles">y</a><a href="#console">z</a>')), "");
});

test("the console without its noindex tag in the static <head> fails", () => {
  const bare = CONSOLE.replace(ROBOTS, "");
  for (const html of [
    bare,
    CONSOLE.replace("noindex, nofollow", "noindex"),
    CONSOLE.replace("noindex, nofollow", "nofollow"),
    CONSOLE.replace('name="robots"', 'name="googlebot"'),
    bare.replace("<title>", `<!-- ${ROBOTS} --><title>`),
    bare.replace("<title>", `<script>document.head.insertAdjacentHTML("beforeend", '${ROBOTS}')</script><title>`),
    bare.replace("<body>", `<body>${ROBOTS}`),
  ]) {
    assert.match(
      errors({ "console/index.html": html }),
      /docs\/console\/index\.html has no <meta name="robots" content="noindex, nofollow"> in its static <head>/,
      html,
    );
  }
});

test("the console's noindex tag may be spelled other ways", () => {
  for (const tag of ['<meta content="nofollow,noindex" name="robots">', "<meta name='robots' content='none'>"]) {
    assert.equal(errors({ "console/index.html": CONSOLE.replace(ROBOTS, tag) }), "", tag);
  }
});

test("every page under docs/console/ needs the tag, and the console needs an index.html", () => {
  assert.match(errors({ "console/help/index.html": "<html><head></head></html>" }), /docs\/console\/help\/index\.html has no/);
  assert.match(errors({ "console/index.html": null }), /docs\/console\/index\.html is missing/);
});

test("a file outside docs/console/ that refers to console/assets/ fails", () => {
  assert.match(errors({ "assets/index.js": 'import("/console/assets/console.js")' }), /docs\/assets\/index\.js refers to console\/assets\//);
  assert.match(errors({ "assets/index.css": '@import "console/assets/c.css";' }), /docs\/assets\/index\.css refers to console\/assets\//);
});

test("binary files are not read for console references", () => {
  assert.equal(errors({ "hero.mp4": "/console/assets/console.js" }), "");
});

test("a sitemap that lists the console fails", () => {
  const listed = SITEMAP.replace("</urlset>", "<url><loc> https://floodwall.ai/console/ </loc></url></urlset>");
  assert.match(errors({ "sitemap.xml": listed }), /docs\/sitemap\.xml lists a console URL \(https:\/\/floodwall\.ai\/console\/\)/);
});

test("a missing landing page or sitemap fails", () => {
  assert.match(errors({ "index.html": null }), /docs\/index\.html is missing/);
  assert.match(errors({ "sitemap.xml": null }), /docs\/sitemap\.xml is missing/);
});

test("landing sources are matched by file and by directory", () => {
  assert.deepEqual(
    landingChanges([
      "site/src/sections/Hero.tsx",
      "site/src/landing/LandingHero.tsx",
      "site\\src\\styles\\theme.css",
      "site/public/robots.txt",
      "site/index.html",
      "site/src/App.tsx",
      "site/src/App.tsx",
    ]),
    [
      "site/index.html",
      "site/public/robots.txt",
      "site/src/App.tsx",
      "site/src/landing/LandingHero.tsx",
      "site/src/sections/Hero.tsx",
      "site/src/styles/theme.css",
    ],
  );
});

test("the console, the crate and the tooling are not landing sources", () => {
  assert.deepEqual(
    landingChanges([
      "site/src/console/store.tsx",
      "site/console/index.html",
      "site/vite.console.config.ts",
      "site/package.json",
      "site/crate-stats.test.mjs",
      "tools/site-guard.mjs",
      "site/src/landingish.ts",
      "site/index.html.orig",
      "docs/index.html",
      "src/lib.rs",
      ".github/workflows/ci.yml",
    ]),
    [],
  );
});

test("a landing change fails without the approval label and passes with it", () => {
  const changed = ["site/src/sections/Hero.tsx", "src/lib.rs"];
  const refused = checkLanding({ changed, labels: ["enhancement"] });
  assert.equal(refused.errors.length, 1);
  assert.match(refused.errors[0], /touch the public landing page/);
  assert.match(refused.errors[0], /^ {2}site\/src\/sections\/Hero\.tsx$/m);
  assert.doesNotMatch(refused.errors[0], /src\/lib\.rs/);
  assert.match(refused.errors[0], new RegExp(`add the ${APPROVAL_LABEL} label`));

  const approved = checkLanding({ changed, labels: [APPROVAL_LABEL] });
  assert.deepEqual(approved.errors, []);
  assert.match(approved.notices[0], /approved by the landing-change-approved label/);

  assert.deepEqual(checkLanding({ changed: ["src/lib.rs"], labels: [] }).errors, []);
});

/** A git repository with one commit on main. */
function repo() {
  const dir = tree({ "site/src/sections/Hero.tsx": "hero\n", "site/src/console/store.tsx": "store\n", "src/lib.rs": "lib\n" });
  const config = ["user.name=guard", "user.email=guard@example.com", "commit.gpgsign=false", "core.autocrlf=false"];
  const git = (...args) => execFileSync("git", [...config.flatMap((c) => ["-c", c]), ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { dir, git, write: (rel, text) => fs.writeFileSync(path.join(dir, rel), text) };
}

test("a pull request's changes count from where it left its base", () => {
  const { dir, git, write } = repo();
  git("switch", "-q", "-c", "feature");
  write("site/src/console/store.tsx", "store 2\n");
  git("commit", "-q", "-am", "console");
  git("switch", "-q", "main");
  write("site/src/sections/Hero.tsx", "hero 2\n");
  git("commit", "-q", "-am", "landing, on main after the branch point");
  assert.deepEqual(changedFiles(dir, "main", "feature"), ["site/src/console/store.tsx"]);
});

test("a file moved out of a landing directory counts", () => {
  const { dir, git } = repo();
  git("switch", "-q", "-c", "feature");
  git("mv", "site/src/sections/Hero.tsx", "site/src/console/Hero.tsx");
  git("commit", "-q", "-m", "move");
  assert.deepEqual(landingChanges(changedFiles(dir, "main", "feature")), ["site/src/sections/Hero.tsx"]);
});

test("without --head, the working tree counts, untracked files included", () => {
  const { dir, write } = repo();
  write("site/src/sections/Hero.tsx", "edited\n");
  fs.mkdirSync(path.join(dir, "site/src/landing"));
  write("site/src/landing/New.tsx", "new\n");
  assert.deepEqual(landingChanges(changedFiles(dir, "main")), ["site/src/landing/New.tsx", "site/src/sections/Hero.tsx"]);
});

const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("the command line exits 0 when the rules hold, 1 when one is broken, 2 on bad usage", () => {
  const ok = run(["built", site()]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^ok: /m);

  const listed = SITEMAP.replace("</urlset>", "<url><loc>https://floodwall.ai/console/</loc></url></urlset>");
  const broken = run(["built", site({ "sitemap.xml": listed })]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /^error: docs\/sitemap\.xml lists a console URL/m);

  for (const args of [[], ["nonsense"], ["landing"], ["landing", "--head", "HEAD"], ["landing", "--base", "HEAD", "--base", "HEAD"]]) {
    assert.equal(run(args).status, 2, args.join(" "));
  }
});

test("PR_LABELS must be a JSON array of names", () => {
  const result = run(["landing", "--base", "HEAD"], { PR_LABELS: APPROVAL_LABEL });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PR_LABELS must be a JSON array of label names/);
});
