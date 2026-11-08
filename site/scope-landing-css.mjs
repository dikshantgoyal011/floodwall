// The landing page's stylesheets (src/styles/landing) were written for a page of their own: they
// style :root, html, body and bare elements, and name tokens such as --muted and --radius that the
// Tailwind and shadcn styles of /pricing, sign-in and the console also use. This build step keeps
// them as written and confines them to `.fw-site`: <html> on the landing page (theme.js and App.tsx
// add it there) and the display: contents boxes around the header and footer on /pricing.

export const SCOPE = ".fw-site";

/**
 * Split a selector list on its top-level commas, leaving commas inside (), [] and quotes alone.
 * @param {string} list
 * @returns {string[]}
 */
export function splitSelectors(list) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * The selector a landing rule gets inside the scope:
 * - `:root…` becomes `.fw-site…`, so tokens and theme switches live on the scope element;
 * - `html…` becomes `html.fw-site…`, document-level rules that only the landing page needs;
 * - `body…` also matches a scope element that is not <html>, so a /pricing box inherits the body
 *   type and colours the header and footer were drawn with;
 * - anything else must sit inside the scope.
 * @param {string} selector one selector of a list
 * @returns {string}
 */
export function scopeSelector(selector) {
  const rootMatch = selector.match(/^:root(?![\w-])/);
  if (rootMatch) return SCOPE + selector.slice(rootMatch[0].length);
  if (/^html(?![\w-])/.test(selector)) return `html${SCOPE}${selector.slice(4)}`;
  if (/^body(?![\w-])/.test(selector)) {
    return `${SCOPE} ${selector}, ${SCOPE}:not(html)${selector.slice(4)}`;
  }
  return `${SCOPE} ${selector}`;
}

/**
 * A PostCSS plugin that scopes every rule of the stylesheets whose path matches `files`.
 * Keyframe steps are left as they are.
 * @param {RegExp} files
 */
export function scopeLandingCss(files) {
  return {
    postcssPlugin: "floodwall-scope-landing-css",
    /** @param {any} root */
    Once(root) {
      if (!files.test(root.source?.input.file ?? "")) return;
      root.walkRules((/** @type {any} */ rule) => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
        rule.selector = splitSelectors(rule.selector).map(scopeSelector).join(",\n");
      });
    },
  };
}
