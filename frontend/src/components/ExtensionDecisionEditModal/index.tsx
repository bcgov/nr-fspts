import {
  Button,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Loading,
  RadioButton,
  RadioButtonGroup,
  TextArea,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { useEffect, useRef, useState, type FC } from 'react';

import DragDropFileInput from '@/components/DragDropFileInput';
import { useNotification } from '@/context/notification/useNotification';
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  validateAttachmentFile,
} from '@/lib/attachmentConstraints';
import {
  uploadExtensionAttachment,
  type FspExtensionDecision,
} from '@/services/fspSearch';
// Reuse the DDM decision dialog's layout (body rhythm, full-width banner,
// compact date row) so the two decision dialogs read identically.
import '../DdmDecisionEditModal/ddm-decision-modal.scss';

/**
 * Extension decision letter attachment type. FSP_700_WORKFLOW's
 * validate_ext_approve_reject requires an attachment of this type to be
 * linked to the extension (via fsp_extension_xref) before an approve or
 * reject will succeed — see FSP_302_EXTENSION_REQUEST.CREATE_ATTACHMENT.
 */
const EXTENSION_DECISION_TYPE_CODE = 'EXDDMD';

/** Maps onto the two SAVE_EXT_* proc actions. */
export type ExtensionDecisionChoice = 'APP' | 'REJ';

export interface ExtensionDecisionSubmitPayload {
  decision: ExtensionDecisionChoice;
  submissionDate: string;
  decisionDate: string;
  /** Only sent when decision is "APP". */
  effectiveDate?: string;
  comment: string;
}

interface ExtensionDecisionEditModalProps {
  open: boolean;
  /** FSP id — used for the ownership fence on the attachment upload. */
  fspId: string;
  /** Current persisted extension decision (if any). Used to pre-fill the form. */
  value: FspExtensionDecision;
  onClose: () => void;
  /**
   * Submit handler. Modal awaits and only closes on success — throw to
   * keep open for retry.
   */
  onSubmit: (payload: ExtensionDecisionSubmitPayload) => Promise<void>;
}

const isoToday = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const decisionFromStatus = (
  statusCode: string | null,
): ExtensionDecisionChoice | null => {
  if (!statusCode) return null;
  const s = statusCode.toUpperCase();
  if (s === 'APP' || s === 'INE') return 'APP';
  if (s === 'REJ') return 'REJ';
  return null;
};

const DECISION_LABEL: Record<ExtensionDecisionChoice, string> = {
  APP: 'Approve',
  REJ: 'Reject',
};

const transitionBanner = (decision: ExtensionDecisionChoice): string => {
  switch (decision) {
    case 'APP':
      return 'Saving will change the extension status to Approved.';
    case 'REJ':
      return 'Saving will change the extension status to Rejected and roll back any term/end-date changes the extension applied.';
  }
};

/**
 * Extension Request decision dialog — Approve or Reject. No Reverse
 * path: the legacy SAVE_EXT_* procs reject {@code p_completed_ind='N'}
 * with FSP.NO.COMPLETE.IND, so once recorded the only way to change is
 * for an Administrator to re-save (the canUpdateApproved rule).
 */
const ExtensionDecisionEditModal: FC<ExtensionDecisionEditModalProps> = ({
  open,
  fspId,
  value,
  onClose,
  onSubmit,
}) => {
  const { display } = useNotification();
  const prevDecision = decisionFromStatus(value.statusCode);
  const [decision, setDecision] = useState<ExtensionDecisionChoice>(
    prevDecision ?? 'APP',
  );
  const [submissionDate, setSubmissionDate] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [comment, setComment] = useState('');
  const [letterFile, setLetterFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  // Guards against re-uploading the letter when the decision save fails and
  // the user retries — the file is uploaded before the save (see submit()),
  // so a naive retry would attach a duplicate.
  const letterUploadedRef = useRef(false);

  // "Record" = first decision (no prior). The decision letter is required
  // in this mode — the workflow proc blocks approve/reject without an
  // extension-linked EXDDMD attachment. An Edit of an existing decision
  // keeps it optional (the original letter is already attached).
  const isRecordMode = !prevDecision;

  useEffect(() => {
    if (!open) return;
    setDecision(prevDecision ?? 'APP');
    setSubmissionDate(value.submissionDate ?? '');
    setDecisionDate(value.decisionDate ?? isoToday());
    setEffectiveDate(value.effectiveDate ?? '');
    setComment(value.comment ?? '');
    setLetterFile(null);
    letterUploadedRef.current = false;
  }, [open, prevDecision, value]);

  const needsEffectiveDate = decision === 'APP';
  const submissionMissing = submissionDate.trim() === '';
  const decisionDateMissing = decisionDate.trim() === '';
  const effectiveMissing = needsEffectiveDate && effectiveDate.trim() === '';
  const letterMissing = isRecordMode && !letterFile;
  const canSubmit =
    !saving &&
    !submissionMissing &&
    !decisionDateMissing &&
    !effectiveMissing &&
    !letterMissing;

  const closeDialog = () => {
    if (saving) return;
    onClose();
  };

  const onLetterSelect = (file: File) => {
    const problem = validateAttachmentFile(file);
    if (problem) {
      display({ kind: 'error', ...problem, timeout: 6000 });
      setLetterFile(null);
      return;
    }
    setLetterFile(file);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    // 1. Upload the decision letter FIRST. FSP_700_WORKFLOW's
    //    validate_ext_approve_reject requires an extension-linked EXDDMD
    //    attachment to already exist before an approve/reject save — so the
    //    letter has to land (linked to the extension via fsp_extension_xref)
    //    before we save the decision. Skip if it already uploaded on a prior
    //    attempt (guarded ref) so a retry doesn't duplicate it.
    if (letterFile && !letterUploadedRef.current) {
      const extensionId = value.extensionId;
      if (!extensionId) {
        display({
          kind: 'error',
          title: 'Cannot upload the decision letter',
          subtitle: 'This extension has no id yet.',
          timeout: 9000,
        });
        setSaving(false);
        return;
      }
      try {
        await uploadExtensionAttachment(
          fspId,
          extensionId,
          EXTENSION_DECISION_TYPE_CODE,
          letterFile,
          'Extension decision letter',
        );
        letterUploadedRef.current = true;
      } catch (e) {
        display({
          kind: 'error',
          title: 'Failed to upload the decision letter',
          subtitle: e instanceof Error ? e.message : 'Unknown error',
          timeout: 9000,
        });
        setSaving(false);
        return;
      }
    }
    // 2. Save the decision. On failure keep the modal open for retry — the
    //    already-uploaded letter is reused (not re-uploaded) on the retry.
    try {
      await onSubmit({
        decision,
        submissionDate,
        decisionDate,
        effectiveDate: needsEffectiveDate ? effectiveDate : undefined,
        comment: comment.trim(),
      });
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save extension decision',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSaving(false);
    }
  };

  const letterDescription =
    `Supported file types are ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}. `
    + `Max file size is 50 MB.\n`
    + (isRecordMode ? 'Required before saving the decision. ' : '')
    + 'Stored against this extension and visible on the Attachments tab.';

  return (
    <Modal
      open={open}
      modalHeading={
        prevDecision
          ? 'Edit extension decision'
          : 'Record extension decision'
      }
      passiveModal
      size="md"
      className="fsp-species-modal ddm-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form ddm-modal__body">
        <p className="fsp-species-modal__subtitle">
          All fields are required unless marked optional.
        </p>

        <InlineNotification
          className="ddm-modal__banner"
          kind="info"
          lowContrast
          hideCloseButton
          title={transitionBanner(decision)}
          subtitle=""
        />

        <RadioButtonGroup
          legendText="Decision"
          name="ext-decision"
          valueSelected={decision}
          orientation="vertical"
          onChange={(v) => setDecision(v as ExtensionDecisionChoice)}
        >
          <RadioButton
            id="ext-decision-app"
            labelText={DECISION_LABEL.APP}
            value="APP"
            disabled={saving}
          />
          <RadioButton
            id="ext-decision-rej"
            labelText={DECISION_LABEL.REJ}
            value="REJ"
            disabled={saving}
          />
        </RadioButtonGroup>

        <DatePicker
          datePickerType="single"
          dateFormat="Y-m-d"
          value={submissionDate || undefined}
          onChange={(dates: Date[]) =>
            setSubmissionDate(dates[0] ? toIsoDate(dates[0]) : '')
          }
        >
          <DatePickerInput
            id="ext-submission-date"
            placeholder="YYYY-MM-DD"
            labelText="Submission date"
            disabled={saving}
            invalid={submissionMissing}
            invalidText="Submission date is required."
          />
        </DatePicker>

        <div className="ddm-modal__date-row">
          <div className="ddm-modal__date-cell">
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              value={decisionDate || undefined}
              onChange={(dates: Date[]) =>
                setDecisionDate(dates[0] ? toIsoDate(dates[0]) : '')
              }
            >
              <DatePickerInput
                id="ext-decision-date"
                placeholder="YYYY-MM-DD"
                labelText="Decision date"
                disabled={saving}
                invalid={decisionDateMissing}
                invalidText="Decision date is required."
              />
            </DatePicker>
          </div>

          {needsEffectiveDate && (
            <div className="ddm-modal__date-cell">
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={effectiveDate || undefined}
                onChange={(dates: Date[]) =>
                  setEffectiveDate(dates[0] ? toIsoDate(dates[0]) : '')
                }
              >
                <DatePickerInput
                  id="ext-effective-date"
                  placeholder="YYYY-MM-DD"
                  labelText="Effective date"
                  disabled={saving}
                  invalid={effectiveMissing}
                  invalidText="Effective date is required for Approve."
                />
              </DatePicker>
            </div>
          )}
        </div>

        <div className="ddm-modal__letter">
          <p className="ddm-modal__section-title">Decision letter</p>
          <p className="ddm-modal__letter-desc">{letterDescription}</p>
          <DragDropFileInput
            accept={ACCEPTED_ATTACHMENT_EXTENSIONS}
            file={letterFile}
            // Not flagged invalid just because it's empty on open — the
            // requirement is already conveyed by the disabled Save button
            // and the "Required before saving" helper text. Marking it
            // invalid up-front painted the dropzone red the moment the
            // dialog opened.
            disabled={saving}
            onSelect={onLetterSelect}
            onRemove={() => setLetterFile(null)}
          />
        </div>

        <TextArea
          id="ext-comment"
          labelText="Comment (optional)"
          enableCounter
          maxCount={4000}
          rows={4}
          value={comment}
          disabled={saving}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={saving} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={!canSubmit}
          renderIcon={saving ? SavingIcon : undefined}
          onClick={() => void submit()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
};

const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default ExtensionDecisionEditModal;
