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
import { useEffect, useMemo, useState, type FC } from 'react';

import ConfirmationModal from '@/components/ConfirmationModal';
import { useNotification } from '@/context/notification/useNotification';
import type { FspDdmDecision } from '@/services/fspSearch';

/** Maps onto the three SAVE_DDM_* proc actions. */
export type DdmDecisionChoice = 'APP' | 'DFT' | 'REJ';

export interface DdmDecisionSubmitPayload {
  decision: DdmDecisionChoice;
  submissionDate: string;
  decisionDate: string;
  /** Only sent when decision is "APP". */
  effectiveDate?: string;
  comment: string;
}

export interface DdmReversePayload {
  /** The status code currently in effect — drives which SAVE_DDM_* the reverse routes to. */
  currentStatusCode: string;
}

interface DdmDecisionEditModalProps {
  open: boolean;
  /** Current persisted decision (if any). Used to pre-fill the form. */
  value: FspDdmDecision;
  /** Current FSP status — needed so the Reverse path can target the right SAVE_DDM_*. */
  currentStatusCode: string | null;
  onClose: () => void;
  /**
   * Submit a fresh decision (or update an existing one). Modal awaits
   * and only closes on success — throw to keep the modal open.
   */
  onSubmit: (payload: DdmDecisionSubmitPayload) => Promise<void>;
  /**
   * Reverse the currently-saved decision (proc's "undo" branch, runs
   * with p_completed_ind='N'). Only invoked when an existing decision
   * is in effect. Modal awaits, closes on success.
   */
  onReverse: (payload: DdmReversePayload) => Promise<void>;
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

/**
 * Map current FSP status code to the existing decision choice it
 * implies. APP / INE → Approved; DFT → Clarification Requested;
 * REJ → Rejected. Blank / SUB / OHS → no prior decision.
 */
const decisionFromStatus = (
  statusCode: string | null,
): DdmDecisionChoice | null => {
  if (!statusCode) return null;
  const s = statusCode.toUpperCase();
  if (s === 'APP' || s === 'INE') return 'APP';
  if (s === 'DFT') return 'DFT';
  if (s === 'REJ') return 'REJ';
  return null;
};

const DECISION_LABEL: Record<DdmDecisionChoice, string> = {
  APP: 'Approve',
  DFT: 'Request Clarification',
  REJ: 'Reject',
};

/** Banner copy describing the status transition that the save triggers. */
const transitionBanner = (decision: DdmDecisionChoice): string => {
  switch (decision) {
    case 'APP':
      return 'Saving will change the FSP status to Approved.';
    case 'DFT':
      return 'Saving will change the FSP status to Clarification Requested.';
    case 'REJ':
      return 'Saving will change the FSP status to Rejected.';
  }
};

/**
 * One-screen DDM decision editor — replaces the legacy three-row
 * mutually-exclusive-checkbox grid plus the {@code toggleDDM()} JS
 * hack. The RadioButtonGroup makes the mutual exclusion structural,
 * and conditional date fields keep the form short.
 */
const DdmDecisionEditModal: FC<DdmDecisionEditModalProps> = ({
  open,
  value,
  currentStatusCode,
  onClose,
  onSubmit,
  onReverse,
}) => {
  const { display } = useNotification();
  const prevDecision = useMemo(
    () => decisionFromStatus(currentStatusCode),
    [currentStatusCode],
  );
  const [decision, setDecision] = useState<DdmDecisionChoice>(
    prevDecision ?? 'APP',
  );
  const [submissionDate, setSubmissionDate] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [reverseConfirmOpen, setReverseConfirmOpen] = useState(false);

  // Re-prefill on every open so re-opening the dialog reflects the
  // current persisted decision rather than whatever the user typed
  // last time and then closed without saving.
  useEffect(() => {
    if (!open) return;
    setDecision(prevDecision ?? 'APP');
    setSubmissionDate(value.submissionDate ?? '');
    setDecisionDate(value.decisionDate ?? isoToday());
    setEffectiveDate(value.effectiveDate ?? '');
    setComment(value.comment ?? '');
  }, [open, prevDecision, value]);

  const needsSubmissionDate = decision === 'APP' || decision === 'REJ';
  const needsEffectiveDate = decision === 'APP';
  const needsComment = decision === 'DFT';

  const submissionMissing = needsSubmissionDate && submissionDate.trim() === '';
  const decisionDateMissing = decisionDate.trim() === '';
  const effectiveMissing = needsEffectiveDate && effectiveDate.trim() === '';
  const commentMissing = needsComment && comment.trim() === '';
  const canSubmit =
    !saving &&
    !submissionMissing &&
    !decisionDateMissing &&
    !effectiveMissing &&
    !commentMissing;

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
        submissionDate: needsSubmissionDate ? submissionDate : '',
        decisionDate,
        effectiveDate: needsEffectiveDate ? effectiveDate : undefined,
        comment: comment.trim(),
      });
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save DDM decision',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSaving(false);
    }
  };

  const performReverse = async () => {
    if (!currentStatusCode) return;
    await onReverse({ currentStatusCode });
    // ConfirmationModal closes itself on success; close the parent too.
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        modalHeading={prevDecision ? 'Edit DDM Decision' : 'Record DDM Decision'}
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
          <RadioButtonGroup
            legendText="Decision *"
            name="ddm-decision"
            valueSelected={decision}
            orientation="vertical"
            onChange={(v) => setDecision(v as DdmDecisionChoice)}
          >
            <RadioButton
              id="ddm-decision-app"
              labelText={DECISION_LABEL.APP}
              value="APP"
              disabled={saving}
            />
            <RadioButton
              id="ddm-decision-dft"
              labelText={DECISION_LABEL.DFT}
              value="DFT"
              disabled={saving}
            />
            <RadioButton
              id="ddm-decision-rej"
              labelText={DECISION_LABEL.REJ}
              value="REJ"
              disabled={saving}
            />
          </RadioButtonGroup>

          {needsSubmissionDate && (
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              value={submissionDate || undefined}
              onChange={(dates: Date[]) =>
                setSubmissionDate(dates[0] ? toIsoDate(dates[0]) : '')
              }
            >
              <DatePickerInput
                id="ddm-submission-date"
                placeholder="YYYY-MM-DD"
                labelText="Submission Date *"
                disabled={saving}
                invalid={submissionMissing}
                invalidText="Submission date is required."
              />
            </DatePicker>
          )}

          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            value={decisionDate || undefined}
            onChange={(dates: Date[]) =>
              setDecisionDate(dates[0] ? toIsoDate(dates[0]) : '')
            }
          >
            <DatePickerInput
              id="ddm-decision-date"
              placeholder="YYYY-MM-DD"
              labelText="Decision Date *"
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
                id="ddm-effective-date"
                placeholder="YYYY-MM-DD"
                labelText="Effective Date *"
                disabled={saving}
                invalid={effectiveMissing}
                invalidText="Effective date is required for Approve."
              />
            </DatePicker>
          )}

          <TextArea
            id="ddm-comment"
            labelText={needsComment ? 'Comment *' : 'Comment'}
            helperText={
              needsComment
                ? 'A comment is required when requesting clarification.'
                : 'Optional — up to 4000 characters.'
            }
            maxLength={4000}
            rows={5}
            value={comment}
            disabled={saving}
            invalid={commentMissing}
            invalidText="Comment is required for Request Clarification."
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
          {prevDecision && (
            <Button
              kind="danger--tertiary"
              disabled={saving}
              onClick={() => setReverseConfirmOpen(true)}
            >
              Reverse Decision
            </Button>
          )}
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

      <ConfirmationModal
        open={reverseConfirmOpen}
        onClose={() => setReverseConfirmOpen(false)}
        heading="Reverse DDM Decision"
        confirmLabel="Reverse"
        danger
        errorTitle="Failed to reverse decision"
        onConfirm={performReverse}
      >
        <p>
          Reverse the current decision and return the FSP to{' '}
          {(currentStatusCode ?? '').toUpperCase() === 'INE'
            ? 'Clarification Requested'
            : 'Submitted'}{' '}
          status? This cannot be undone.
        </p>
      </ConfirmationModal>
    </>
  );
};

const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default DdmDecisionEditModal;
