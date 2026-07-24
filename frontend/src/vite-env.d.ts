/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Cognito (FAM via AWS Amplify). Mirrors nr-rept's env contract.
  readonly VITE_USER_POOLS_ID: string;
  readonly VITE_USER_POOLS_WEB_CLIENT_ID: string;
  readonly VITE_BASE_PATH: string;
  // Backend API base path; usually '/api' so Caddy reverse-proxies to the
  // same-zone backend Service.
  readonly VITE_API_BASE_URL: string;
  // Display / theming
  readonly VITE_APP_NAME: string;
  readonly VITE_ZONE: string;
  // Public FOM site base URL — read by the InformationTab "Associated FOMs"
  // links. Should match the host the backend's FOM_API_URL points at (test
  // FOM for TEST/local, prod for PROD). Empty falls back to the prod host.
  readonly VITE_FOM_PUBLIC_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
