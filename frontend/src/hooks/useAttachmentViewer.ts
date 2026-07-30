import { useState } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { safeErrorMessage } from '@/lib/errorMessage';
import { fetchFspAttachmentBlob } from '@/services/fspSearch';

/**
 * Opens a single FSP attachment inline in a new browser tab.
 *
 * The blob endpoint is Bearer-authenticated, so we can't just point an
 * `<a target="_blank">` at it — we open a blank tab *synchronously* (before
 * the await) to dodge the pop-up blocker, fetch the bytes, then hand the
 * object URL to that tab. Shared by the Attachments tab's "View" action and
 * the Workflow tab's decision-letter links.
 *
 * Returns {@code view(attachmentId, fileName)} plus {@code viewingId}, the id
 * currently loading (so callers can disable the triggering control).
 */
export function useAttachmentViewer(fspId: string) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const { display } = useNotification();

  const view = async (attachmentId: string, fileName: string | null) => {
    if (viewingId) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      display({
        kind: 'error',
        title: 'Pop-up blocked',
        subtitle: 'Allow pop-ups for this site to view attachments.',
        timeout: 7000,
      });
      return;
    }
    setViewingId(attachmentId);
    try {
      const blob = await fetchFspAttachmentBlob(fspId, attachmentId, fileName);
      // Object URL is left un-revoked — the new tab needs it while it
      // loads; the browser releases it when that tab closes.
      popup.location.href = URL.createObjectURL(blob);
    } catch (e) {
      popup.close();
      display({
        kind: 'error',
        title: 'Could not open attachment',
        subtitle: safeErrorMessage(e, 'Unknown error'),
        timeout: 7000,
      });
    } finally {
      setViewingId(null);
    }
  };

  return { view, viewingId };
}
