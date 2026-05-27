/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Cognito (FAM via AWS Amplify). Mirrors nr-rept's env contract.
  readonly VITE_USER_POOLS_ID: string;
  readonly VITE_USER_POOLS_WEB_CLIENT_ID: string;
  readonly VITE_REDIRECT_SIGN_OUT: string;
  readonly VITE_BASE_PATH: string;
  // Backend API base path; usually '/api' so Caddy reverse-proxies to the
  // same-zone backend Service.
  readonly VITE_API_BASE_URL: string;
  // Display / theming
  readonly VITE_APP_NAME: string;
  readonly VITE_ZONE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
