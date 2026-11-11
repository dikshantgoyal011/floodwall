/** Read from Cargo.toml and src/ at build time; see vite.config.ts. */
declare const __CRATE_STATS__: {
  version: string;
  dependencies: number;
  tests: number;
};

/** A content hash of public/hairline, appended to the diagram script URLs; see vite.config.ts. */
declare const __HAIRLINE_VERSION__: string;
