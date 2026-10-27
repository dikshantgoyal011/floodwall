/** Read from Cargo.toml and src/ at build time; see vite.config.ts. */
declare const __CRATE_STATS__: {
  version: string;
  dependencies: number;
  tests: number;
};
