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
