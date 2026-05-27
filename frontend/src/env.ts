declare global {
  interface Window {
    config: object;
  }
}

// Merges Vite build-time env vars with runtime values injected by
// docker-entrypoint.sh into window.config (loaded from /config.js by
// index.html before the app bundle). Runtime values take precedence so
// a single image works for DEV / TEST / PROD / per-PR previews.
//
// Always read VITE_* vars through this `env` export, not directly from
// `import.meta.env` — direct reads are inlined at build time and resolve
// to `undefined` in deployed containers (where `.env.local` isn't set).
export const env: Record<string, string> = { ...import.meta.env, ...window.config };
