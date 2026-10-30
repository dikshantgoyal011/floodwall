// The page's identity for search engines and link previews: one schema.org
// graph, built at build time from the crate's own Cargo.toml facts so the
// version, licence and description can never drift from the crate.

export const SITE_URL = "https://floodwall.ai/";
export const SITE_NAME = "Floodwall";
export const PAGE_TITLE = "Floodwall | Policy Gates for Agent-Driven DevOps";
export const PAGE_DESCRIPTION =
  "A Rust control plane for high-volume, agent-driven DevOps: admission control, policy gates that admit, defer or reject each intent, and a tamper-evident ledger.";
export const SHARE_IMAGE = {
  url: `${SITE_URL}og/floodwall.png`,
  width: 1200,
  height: 630,
  alt: "Floodwall: When agents flood production, hold the line. An isometric drawing of intents passing admission, a scheduler and a policy gate, with deferred intents on hold, a ledger and checked boxes on dry ground.",
};

const ERP_AI = "https://www.erp.ai/";
const id = (fragment) => `${SITE_URL}#${fragment}`;

/**
 * @param {ReturnType<typeof import("./crate-stats.mjs").readCrateFacts>} crate
 */
export function structuredData(crate) {
  // An SPDX licence page exists per identifier, not per expression ("MIT OR Apache-2.0").
  if (!/^[A-Za-z0-9.+-]+$/.test(crate.license)) throw new Error(`unsupported licence expression: ${crate.license}`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${ERP_AI}#organization`,
        name: "ERP•AI",
        url: ERP_AI,
        // ERP•AI's own stable 512px search icon (its JSON-LD logo URL is release-hashed).
        logo: { "@type": "ImageObject", url: `${ERP_AI}assets/images/erp-ai-search-icon-512.png`, width: 512, height: 512 },
        sameAs: ["https://github.com/erphq"],
      },
      {
        "@type": "WebSite",
        "@id": id("website"),
        url: SITE_URL,
        name: SITE_NAME,
        description: PAGE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": `${ERP_AI}#organization` },
      },
      {
        "@type": "ImageObject",
        "@id": id("share-image"),
        url: SHARE_IMAGE.url,
        contentUrl: SHARE_IMAGE.url,
        width: SHARE_IMAGE.width,
        height: SHARE_IMAGE.height,
        caption: SHARE_IMAGE.alt,
      },
      {
        "@type": "WebPage",
        "@id": id("webpage"),
        url: SITE_URL,
        name: PAGE_TITLE,
        description: PAGE_DESCRIPTION,
        inLanguage: "en",
        isPartOf: { "@id": id("website") },
        about: { "@id": id("software") },
        primaryImageOfPage: { "@id": id("share-image") },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": id("software"),
        name: SITE_NAME,
        alternateName: crate.name,
        description: crate.description,
        url: SITE_URL,
        codeRepository: crate.repository,
        programmingLanguage: { "@type": "ComputerLanguage", name: "Rust" },
        runtimePlatform: `Rust ${crate.rustVersion} or later`,
        version: crate.release,
        license: `https://spdx.org/licenses/${crate.license}.html`,
        keywords: crate.keywords.join(", "),
        isAccessibleForFree: true,
        image: { "@id": id("share-image") },
        publisher: { "@id": `${ERP_AI}#organization` },
      },
    ],
  };
}

/** JSON for an inline <script>: `<` is escaped so no string can close the element. */
export function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The head tags for link previews and search: description, canonical, Open Graph,
 * Twitter card and the JSON-LD graph, as Vite `HtmlTagDescriptor`s.
 * @param {ReturnType<typeof import("./crate-stats.mjs").readCrateFacts>} crate
 * @returns {import("vite").HtmlTagDescriptor[]}
 */
export function headTags(crate) {
  const meta = (attrs) => ({ tag: "meta", attrs, injectTo: "head" });
  // Vite escapes attribute values when it serializes them.
  const property = (name, content) => meta({ property: name, content: String(content) });
  const named = (name, content) => meta({ name, content: String(content) });
  return [
    named("description", PAGE_DESCRIPTION),
    { tag: "link", attrs: { rel: "canonical", href: SITE_URL }, injectTo: "head" },
    property("og:type", "website"),
    property("og:site_name", SITE_NAME),
    property("og:locale", "en_US"),
    property("og:url", SITE_URL),
    property("og:title", PAGE_TITLE),
    property("og:description", PAGE_DESCRIPTION),
    property("og:image", SHARE_IMAGE.url),
    property("og:image:type", "image/png"),
    property("og:image:width", SHARE_IMAGE.width),
    property("og:image:height", SHARE_IMAGE.height),
    property("og:image:alt", SHARE_IMAGE.alt),
    named("twitter:card", "summary_large_image"),
    named("twitter:title", PAGE_TITLE),
    named("twitter:description", PAGE_DESCRIPTION),
    named("twitter:image", SHARE_IMAGE.url),
    named("twitter:image:alt", SHARE_IMAGE.alt),
    { tag: "script", attrs: { type: "application/ld+json" }, children: inlineJson(structuredData(crate)), injectTo: "head" },
  ];
}
