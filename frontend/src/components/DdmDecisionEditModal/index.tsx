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

interface DdmDecisionEditModalProps {
  open: boolean;
  /** Current persisted decision (if any). Used to pre-fill the form. */
  value: FspDdmDecision;
  /** Current FSP status — used to pre-select the matching decision radio. */
  currentStatusCode: string | null;
  /**
   * Decision choices the current user may take, per FSPTS Permission Matrix
   * section D (e.g. an Administrator on Submitted gets {@code ['DFT']} only —
   * they are dashed out of Approve/Reject; a DM/Reviewer gets all three).
   * Choices outside this set are rendered disabled, and the initial
   * selection is forced onto an allowed choice. Defaults to all three when
   * omitted.
   */
  allowedDecisions?: DdmDecisionChoice[];
  onClose: () => void;
  /**
   * Submit a fresh decision (or update an existing one). Modal awaits
   * and only closes on success — throw to keep the modal open.
   */
  onSubmit: (payload: DdmDecisionSubmitPayload) => Promise<void>;
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
  DFT: 'Request clarification',
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
const ALL_DECISIONS: DdmDecisionChoice[] = ['APP', 'DFT', 'REJ'];

const DdmDecisionEditModal: FC<DdmDecisionEditModalProps> = ({
  open,
  value,
  currentStatusCode,
  allowedDecisions = ALL_DECISIONS,
  onClose,
  onSubmit,
}) => {
  const { display } = useNotification();
  const prevDecision = useMemo(
    () => decisionFromStatus(currentStatusCode),
    [currentStatusCode],
  );
  const isAllowed = (choice: DdmDecisionChoice): boolean =>
    allowedDecisions.includes(choice);
  // Initial selection: the persisted decision when the user may still take
  // it, otherwise the first choice they are allowed (so an Administrator
  // restricted to Request-clarification lands on DFT rather than a disabled
  // Approve radio).
  const initialDecision = useMemo<DdmDecisionChoice>(() => {
    if (prevDecision && allowedDecisions.includes(prevDecision)) {
      return prevDecision;
    }
    return allowedDecisions[0] ?? prevDecision ?? 'APP';
  }, [prevDecision, allowedDecisions]);
  const [decision, setDecision] = useState<DdmDecisionChoice>(initialDecision);
  const [decisionDate, setDecisionDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  // Approved state — covers both APP (Approved) and INE (In Effect).
  // Used to lock the Reject / Request-Clarification radios so a DDM
  // can't pivot the decision after the FSP has been approved.
  const isApproved = prevDecision === 'APP';

  // Re-prefill on every open so re-opening the dialog reflects the
  // current persisted decision rather than whatever the user typed
  // last time and then closed without saving.
  useEffect(() => {
    if (!open) return;
    setDecision(initialDecision);
    setDecisionDate(value.decisionDate ?? isoToday());
    setEffectiveDate(value.effectiveDate ?? '');
    setComment(value.comment ?? '');
  }, [open, initialDecision, value]);

  const needsEffectiveDate = decision === 'APP';
  const needsComment = decision === 'DFT';

  const decisionDateMissing = decisionDate.trim() === '';
  const effectiveMissing = needsEffectiveDate && effectiveDate.trim() === '';
  const commentMissing = needsComment && comment.trim() === '';
  const canSubmit =
    !saving &&
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
        // Submission date is set by the user's Submit FSP action and
        // shouldn't be changed here. Pass through whatever the proc
        // already has on the row so the SAVE_DDM_* call doesn't
        // overwrite the real submission timestamp.
        submissionDate: value.submissionDate ?? '',
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

  return (
    <>
      <Modal
        open={open}
        modalHeading={prevDecision ? 'Edit DDM decision' : 'Record DDM decision'}
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
            {/* Approve / Reject are disabled for roles the matrix dashes
                out of them (e.g. an Administrator, who may only Request
                clarification). isAllowed() carries that per-role gate. */}
            <RadioButton
              id="ddm-decision-app"
              labelText={DECISION_LABEL.APP}
              value="APP"
              disabled={saving || !isAllowed('APP')}
            />
            {/* Reject and Request Clarification are also locked once the
                FSP has been approved (APP / INE): in that state the dialog
                can only adjust the existing Approve row's dates and comment
                — flipping to REJ/DFT after an approval is not allowed. */}
            <RadioButton
              id="ddm-decision-dft"
              labelText={DECISION_LABEL.DFT}
              value="DFT"
              disabled={saving || isApproved || !isAllowed('DFT')}
            />
            <RadioButton
              id="ddm-decision-rej"
              labelText={DECISION_LABEL.REJ}
              value="REJ"
              disabled={saving || isApproved || !isAllowed('REJ')}
            />
          </RadioButtonGroup>
          {isApproved && (
            <InlineNotification
              kind="info"
              lowContrast
              hideCloseButton
              title="Approved FSPs can only be edited, not rejected or returned for clarification."
              subtitle=""
            />
          )}

          {/* Submission Date intentionally omitted — it's set by the
              submitter's Submit FSP action and isn't editable here.
              The legacy FSP700 page showed it as a field too but had
              no path to actually persist a change, so it was just
              cosmetic UI weight. */}

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
                id="ddm-effective-date"
                placeholder="YYYY-MM-DD"
                labelText="Effective date *"
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
    </>
  );
};

const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default DdmDecisionEditModal;
