/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The sign-in service's address (api/README.md); unset runs the in-browser demo. */
  readonly VITE_AUTH_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
