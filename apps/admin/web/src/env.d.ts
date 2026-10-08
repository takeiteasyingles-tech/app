/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Cloudflare Turnstile sitekey of the admin Worker (wrangler var TURNSTILE_SITEKEY). Set it at build
   * time for production; on localhost the always-pass test key is used when it is absent.
   */
  readonly VITE_TURNSTILE_SITEKEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
