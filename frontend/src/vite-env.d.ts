/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Google Apps Script web app the public site uses as its backend; unset for the AWS API and the local mock. */
  readonly VITE_SHEETS_URL?: string;
  /** "cl" for the Chilean site, in Spanish with the Sheet's Chile hints; unset for the English site. */
  readonly VITE_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
