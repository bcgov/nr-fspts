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
import { useEffect, useState, type FC } from 'react';

import DragDropFileInput from '@/components/DragDropFileInput';
import { useNotification } from '@/context/notification/useNotification';
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  validateAttachmentFile,
} from '@/lib/attachmentConstraints';
import { safeErrorMessage } from '@/lib/errorMessage';
import { type FspExtensionDecision } from '@/services/fspSearch';
// Reuse the DDM decision dialog's layout (body rhythm, full-width banner,
// compact date row) so the two decision dialogs read identically.
import '../DdmDecisionEditModal/ddm-decision-modal.scss';

/**
 * Extension decision letter attachment type. FSP_700_WORKFLOW's
 * validate_ext_approve_reject requires an attachment of this type to be
 * linked to the extension (via fsp_extension_xref) before an approve or
 * reject will succeed — see FSP_302_EXTENSION_REQUEST.CREATE_ATTACHMENT.
 *
 * The code itself now lives server-side in
 * {@code WorkflowService.TYPE_EXTENSION_DDM_DECISION}: the combined
 * decision endpoint owns the upload, so the dialog only carries the file.
 */

/** Maps onto the two SAVE_EXT_* proc actions. */
export type ExtensionDecisionChoice = 'APP' | 'REJ';

export interface ExtensionDecisionSubmitPayload {
  decision: ExtensionDecisionChoice;
  submissionDate: string;
  decisionDate: string;
  /** Only sent when decision is "APP". */
  effectiveDate?: string;
  comment: string;
  /**
   * The EXDDMD decision letter, handed to the parent rather than uploaded
   * here. The letter and the decision are one unit of work — the parent
   * posts both to the combined endpoint so they commit or roll back
   * together. Null when the extension already has its letter on file.
   */
  letterFile: File | null;
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
  // Required-field highlighting is held back until the first Save attempt so
  // the form doesn't open painted red. Set true when the user clicks Save
  // with something missing.
  const [showValidation, setShowValidation] = useState(false);
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
    setShowValidation(false);
  }, [open, prevDecision, value]);

  const needsEffectiveDate = decision === 'APP';
  const submissionMissing = submissionDate.trim() === '';
  const decisionDateMissing = decisionDate.trim() === '';
  const effectiveMissing = needsEffectiveDate && effectiveDate.trim() === '';
  const letterMissing = isRecordMode && !letterFile;
  const hasErrors =
    submissionMissing ||
    decisionDateMissing ||
    effectiveMissing ||
    letterMissing;

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
    if (saving) return;
    // Save is always enabled; on click, surface any missing required fields
    // instead of proceeding.
    if (hasErrors) {
      setShowValidation(true);
      return;
    }
    if (letterFile && !value.extensionId) {
      display({
        kind: 'error',
        title: 'Cannot upload the decision letter',
        subtitle: 'This extension has no id yet.',
        timeout: 9000,
      });
      return;
    }
    setSaving(true);
    // The letter and the decision go up together in one atomic call — the
    // parent posts both to /extensions/{id}/decision, which links the
    // EXDDMD via fsp_extension_xref BEFORE running FSP_700_WORKFLOW (whose
    // validate_ext_approve_reject requires that linkage) and rolls both
    // back on failure. This dialog used to upload the letter itself in a
    // separate committed request, so a decision that failed afterwards
    // left an orphaned letter linked to the extension; a guard ref then
    // had to suppress a re-upload on retry. Neither is needed now — a
    // failed attempt commits nothing, so retrying re-sends the file.
    try {
      await onSubmit({
        decision,
        submissionDate,
        decisionDate,
        effectiveDate: needsEffectiveDate ? effectiveDate : undefined,
        comment: comment.trim(),
        letterFile,
      });
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save extension decision',
        subtitle: safeErrorMessage(e, 'Please try again later.'),
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
    + 'Stored against this extension.';

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
          // Carbon's DatePicker clones the child input and injects `invalid`
          // from ITS own props, so the flag has to live here, not (only) on
          // the DatePickerInput — otherwise the red state never shows.
          invalid={showValidation && submissionMissing}
          value={submissionDate}
          onChange={(dates: Date[]) =>
            setSubmissionDate(dates[0] ? toIsoDate(dates[0]) : '')
          }
        >
          <DatePickerInput
            id="ext-submission-date"
            placeholder="YYYY-MM-DD"
            labelText="Submission date"
            disabled={saving}
            invalid={showValidation && submissionMissing}
            invalidText="Submission date is required."
            // Carbon restores a typed-then-emptied date on calendar close and
            // flatpickr's onChange doesn't fire on clear — so catch the raw
            // input going empty here and push '' down (which clears flatpickr
            // via the controlled value) so the removed date doesn't snap back.
            // Validation highlighting is deferred to the Save click.
            onChange={(e) => {
              if (!e.target.value.trim()) setSubmissionDate('');
            }}
          />
        </DatePicker>

        <div className="ddm-modal__date-row">
          <div className="ddm-modal__date-cell">
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              invalid={showValidation && decisionDateMissing}
              value={decisionDate}
              onChange={(dates: Date[]) =>
                setDecisionDate(dates[0] ? toIsoDate(dates[0]) : '')
              }
            >
              <DatePickerInput
                id="ext-decision-date"
                placeholder="YYYY-MM-DD"
                labelText="Decision date"
                disabled={saving}
                invalid={showValidation && decisionDateMissing}
                invalidText="Decision date is required."
                onChange={(e) => {
                  if (!e.target.value.trim()) setDecisionDate('');
                }}
              />
            </DatePicker>
          </div>

          {needsEffectiveDate && (
            <div className="ddm-modal__date-cell">
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                invalid={showValidation && effectiveMissing}
                value={effectiveDate}
                onChange={(dates: Date[]) =>
                  setEffectiveDate(dates[0] ? toIsoDate(dates[0]) : '')
                }
              >
                <DatePickerInput
                  id="ext-effective-date"
                  placeholder="YYYY-MM-DD"
                  labelText="Effective date"
                  disabled={saving}
                  invalid={showValidation && effectiveMissing}
                  invalidText="Effective date is required."
                  onChange={(e) => {
                    if (!e.target.value.trim()) setEffectiveDate('');
                  }}
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
            // Only flagged invalid after a Save attempt with no file — not
            // on open — so the dropzone doesn't paint red before the user
            // has had a chance to add the required decision letter.
            invalid={showValidation && letterMissing}
            invalidText="A decision letter is required."
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
        <Button kind="tertiary" disabled={saving} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={saving}
          renderIcon={saving ? SavingIcon : undefined}
          onClick={() => void submit()}
        >
          {saving ? 'Saving…' : 'Record decision'}
        </Button>
      </div>
    </Modal>
  );
};

const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default ExtensionDecisionEditModal;
