import { Button, Link, Loading } from '@carbon/react';
import { Modal } from '@/components/Modal';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import {
  preflightSubmitFsp,
  submitFsp,
  type FspInformation,
  type SubmitPreflightIssue,
} from '@/services/fspSearch';

interface Props {
  open: boolean;
  fsp: FspInformation | null;
  /** Amendment number from URL params, used when the FSP DTO doesn't carry one. */
  fallbackAmendmentNumber: string | null;
  onClose: () => void;
  /**
   * Called with the refreshed FSP after a successful submit so the
   * parent can swap the FSP detail in place without re-navigating.
   */
  onSubmitted: (updated: FspInformation) => void;
  /**
   * Switches the FSP detail to the Attachments tab. Wired to the link in
   * the "missing FSP Legal Document" view so the user lands where they can
   * upload it; the modal closes itself first.
   */
  onOpenAttachments: () => void;
}

/**
 * Preflight issue code (see FspService.CODE_NO_LEGAL_DOCUMENT) raised when
 * the amendment has no FSP Legal Document attached. Rendered as a dedicated
 * "missing required document" view rather than a generic issue bullet.
 */
const CODE_NO_LEGAL_DOCUMENT = 'FSP.NO.LEGAL.DOCUMENT';

/**
 * Submit dialog with a proc-side preflight. Opens, runs
 * {@code GET /v1/fsp/{id}/submit/preflight} (which calls
 * {@code fsp_common_validation.validate_fsp} without touching status),
 * then either shows the legacy warning + an enabled Submit button or
 * a list of the validation issues that need fixing first.
 *
 * <p>Visual structure deliberately mirrors {@code ConfirmationModal}
 * (passive Carbon Modal, heading, body paragraphs, right-aligned
 * Cancel / Submit buttons) so it sits alongside the Delete-draft and
 * Extend dialogs without standing out.
 */
const SubmitFspModal: FC<Props> = ({
  open,
  fsp,
  fallbackAmendmentNumber,
  onClose,
  onSubmitted,
  onOpenAttachments,
}) => {
  const { display } = useNotification();
  const fspId = fsp?.fspId ?? null;
  const amendmentNumber = fsp?.fspAmendmentNumber ?? fallbackAmendmentNumber;

  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SubmitPreflightIssue[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !fspId) return;
    let cancelled = false;
    setPreflightLoading(true);
    setPreflightError(null);
    setIssues(null);
    preflightSubmitFsp(fspId, amendmentNumber)
      .then((res) => {
        if (!cancelled) setIssues(res.issues);
      })
      .catch((e) => {
        if (!cancelled)
          setPreflightError(
            e instanceof Error ? e.message : 'Preflight check failed.',
          );
      })
      .finally(() => {
        if (!cancelled) setPreflightLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fspId, amendmentNumber]);

  const closeDialog = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!fspId) return;
    setSubmitting(true);
    try {
      const updated = await submitFsp(fspId, amendmentNumber);
      onSubmitted(updated);
      display({
        kind: 'success',
        title: `FSP ${fspId} submitted`,
        subtitle: updated.fspStatusDesc
          ? `Status is now "${updated.fspStatusDesc}".`
          : undefined,
        timeout: 6000,
      });
      onClose();
    } catch (e) {
      // Close the dialog on submit failure so the user sees the
      // (sticky) error toast on top of the FSP detail rather than
      // dangling over a half-modal. They can fix the issue in the
      // relevant tab and click Submit FSP again.
      onClose();
      display({
        kind: 'error',
        title: 'Failed to submit FSP',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 0,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const hasIssues = (issues?.length ?? 0) > 0;
  const ready =
    !preflightLoading && !preflightError && issues !== null && !hasIssues;

  // The missing FSP Legal Document gets its own view (dedicated heading +
  // a link straight to the Attachments tab). Other validation issues fall
  // back to the generic bullet list.
  const missingLegalDocument =
    hasIssues && !!issues?.some((i) => i.code === CODE_NO_LEGAL_DOCUMENT);
  const otherIssues = issues?.filter((i) => i.code !== CODE_NO_LEGAL_DOCUMENT);
  const hasOtherIssues = (otherIssues?.length ?? 0) > 0;

  const goToAttachments = () => {
    onClose();
    onOpenAttachments();
  };

  const heading = missingLegalDocument
    ? 'Missing required document'
    : 'Submit this FSP?';

  return (
    <Modal
      open={open}
      modalHeading={heading}
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form">
        {preflightLoading && (
          <p className="submit-fsp-modal__status" role="status" aria-live="polite">
            <Loading small withOverlay={false} description="Validating FSP…" />
            <span>Running validation checks…</span>
          </p>
        )}

        {preflightError && !preflightLoading && (
          <p>Couldn't run validation: {preflightError}</p>
        )}

        {!preflightLoading && !preflightError && missingLegalDocument && (
          <>
            <p>
              FSP <strong>{fspId}</strong> can't be submitted yet.
            </p>
            <p>
              Upload the <strong>FSP Legal Document</strong> under the{' '}
              <Link
                href="#"
                style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
                onClick={(e) => {
                  e.preventDefault();
                  goToAttachments();
                }}
              >
                Attachments
              </Link>{' '}
              tab before submitting.
            </p>
          </>
        )}

        {!preflightLoading &&
          !preflightError &&
          !missingLegalDocument &&
          hasOtherIssues &&
          otherIssues && (
            <>
              <p>
                <strong>{otherIssues.length}</strong>{' '}
                {otherIssues.length === 1 ? 'issue needs' : 'issues need'}{' '}
                attention before you can submit FSP <strong>{fspId}</strong>:
              </p>
              <ul className="submit-fsp-modal__list">
                {otherIssues.map((issue, i) => (
                  <li key={`${issue.code}-${i}`}>{issue.message}</li>
                ))}
              </ul>
            </>
          )}

        {ready && (
          <>
            <p>
              After submitting FSP <strong>{fspId}</strong> you will not be
              able to make any further changes until the Ministry of Forests
              has reviewed it.
            </p>
            <p style={{ marginTop: '1rem' }}>
              Before submitting, please verify that you have attached any
              required documentation.
            </p>
          </>
        )}
      </div>

      {/* When validation blocks submission there's nothing to confirm —
          the only action is to dismiss, which the modal's top X already
          provides. Show the footer buttons only in the ready state. */}
      {ready && (
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={submitting} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={submitting}
          renderIcon={submitting ? BusyIcon : undefined}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
      )}
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default SubmitFspModal;
