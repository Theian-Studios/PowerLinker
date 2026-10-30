/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Google Apps Script web app the public site uses as its backend; unset for the AWS API and the local mock. */
  readonly VITE_SHEETS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
