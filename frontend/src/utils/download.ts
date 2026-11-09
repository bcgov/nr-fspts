/**
 * Triggers a browser file-save for the given blob. Ports nr-rept's
 * utils/download. The temporary anchor element is added/removed
 * immediately so leftover DOM doesn't accumulate on repeated
 * downloads; the object URL is revoked synchronously after click
 * because the browser has already started the download by then.
 */
export const triggerBrowserDownload = (blob: Blob, filename: string): void => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Opens the blob in a new tab (e.g. for inline PDF preview). The URL
 * is NOT revoked immediately — the new tab needs it to remain valid
 * while it loads. Browsers release the object URL when the tab is
 * closed or the document is unloaded.
 */
export const openBlobInNewTab = (blob: Blob): void => {
  const url = window.URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * Opens one of OUR OWN signed-in routes (e.g. `/fsp/map`) in a new tab,
 * carrying the session with it.
 *
 * The Keycloak tokens live in sessionStorage (services/keycloak.ts). A tab
 * opened with `noopener` / `noreferrer` gets a FRESH, empty sessionStorage and
 * so lands on the sign-in screen. Opened without them, the browser copies the
 * opener's sessionStorage into the new tab — tokens, active org and all.
 *
 * The opener link is severed straight after (the copy has already happened at
 * creation), so the new tab still can't script this one. Only for same-origin
 * app routes — external links should keep `noopener,noreferrer`.
 */
export const openAppRouteInNewTab = (url: string): void => {
  const tab = window.open(url, '_blank');
  if (tab) tab.opener = null;
};
