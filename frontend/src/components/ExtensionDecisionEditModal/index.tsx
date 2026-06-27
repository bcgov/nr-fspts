import {
  Button,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Loading,
  Modal,
  RadioButton,
  RadioButtonGroup,
  TextArea,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import type { FspExtensionDecision } from '@/services/fspSearch';

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
  /** Current persisted extension decision (if any). Used to pre-fill the form. */
  value: FspExtensionDecision;
  /** Extension number text for the dialog header — e.g. "Extension 3". */
  extensionLabel: string | null;
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
  value,
  extensionLabel,
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDecision(prevDecision ?? 'APP');
    setSubmissionDate(value.submissionDate ?? '');
    setDecisionDate(value.decisionDate ?? isoToday());
    setEffectiveDate(value.effectiveDate ?? '');
    setComment(value.comment ?? '');
  }, [open, prevDecision, value]);

  const needsEffectiveDate = decision === 'APP';
  const submissionMissing = submissionDate.trim() === '';
  const decisionDateMissing = decisionDate.trim() === '';
  const effectiveMissing = needsEffectiveDate && effectiveDate.trim() === '';
  const canSubmit =
    !saving &&
    !submissionMissing &&
    !decisionDateMissing &&
    !effectiveMissing;

  const closeDialog = () => {
    if (saving) return;
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
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

  return (
    <Modal
      open={open}
      modalHeading={
        prevDecision
          ? 'Edit extension decision'
          : 'Record extension decision'
      }
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form">
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={transitionBanner(decision)}
          subtitle=""
        />
        {extensionLabel && (
          <p className="fsp-info__placeholder" style={{ marginTop: 0 }}>
            <strong>Extension:</strong> {extensionLabel}
          </p>
        )}
        <RadioButtonGroup
          legendText="Decision *"
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
            labelText="Submission date *"
            disabled={saving}
            invalid={submissionMissing}
            invalidText="Submission date is required."
          />
        </DatePicker>

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
            labelText="Decision date *"
            disabled={saving}
            invalid={decisionDateMissing}
            invalidText="Decision date is required."
          />
        </DatePicker>

        {needsEffectiveDate && (
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
              labelText="Effective date *"
              disabled={saving}
              invalid={effectiveMissing}
              invalidText="Effective date is required for Approve."
            />
          </DatePicker>
        )}

        <TextArea
          id="ext-comment"
          labelText="Comment"
          helperText="Optional — up to 4000 characters."
          maxLength={4000}
          rows={5}
          value={comment}
          disabled={saving}
          onChange={(e) => setComment(e.target.value)}
        />

        {value.name && (
          <p className="fsp-info__placeholder" style={{ marginBottom: 0 }}>
            Decided by <strong>{value.name}</strong>.
          </p>
        )}
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
