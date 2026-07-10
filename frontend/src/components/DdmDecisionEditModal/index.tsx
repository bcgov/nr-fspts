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

import DragDropFileInput from '@/components/DragDropFileInput';
import { useNotification } from '@/context/notification/useNotification';
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  validateAttachmentFile,
} from '@/lib/attachmentConstraints';
import {
  getAttachmentCategories,
  uploadFspAttachment,
  type CodeOption,
  type FspDdmDecision,
} from '@/services/fspSearch';
import './ddm-decision-modal.scss';

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
  /** FSP id — the decision letter is uploaded to this FSP's attachments. */
  fspId: string;
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

const COMMENT_MAX = 400;

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
  const status =
    decision === 'APP'
      ? 'Approved'
      : decision === 'DFT'
        ? 'Clarification Requested'
        : 'Rejected';
  return `Saving will change the FSP status to ${status}. The licensee/BCTS contact will be notified by email automatically.`;
};

// Pick the "DDM Decision" attachment category to file the letter under.
const pickDdmCategory = (cats: CodeOption[]): CodeOption | null => {
  const find = (re: RegExp) =>
    cats.find((c) => re.test(`${c.description ?? ''} ${c.code ?? ''}`));
  return find(/ddm/i) ?? find(/decision letter/i) ?? find(/decision/i) ?? null;
};

const ALL_DECISIONS: DdmDecisionChoice[] = ['APP', 'DFT', 'REJ'];

/**
 * One-screen DDM decision editor — replaces the legacy three-row
 * mutually-exclusive-checkbox grid plus the {@code toggleDDM()} JS
 * hack. The RadioButtonGroup makes the mutual exclusion structural,
 * and the decision letter is uploaded to the FSP attachment list after
 * the decision saves (the DDM save proc carries no file).
 */
const DdmDecisionEditModal: FC<DdmDecisionEditModalProps> = ({
  open,
  fspId,
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
  // it, otherwise the first choice they are allowed.
  const initialDecision = useMemo<DdmDecisionChoice>(() => {
    if (prevDecision && allowedDecisions.includes(prevDecision)) {
      return prevDecision;
    }
    return allowedDecisions[0] ?? prevDecision ?? 'APP';
  }, [prevDecision, allowedDecisions]);
  const [decision, setDecision] = useState<DdmDecisionChoice>(initialDecision);
  const [submissionDate, setSubmissionDate] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [comment, setComment] = useState('');
  const [letterFile, setLetterFile] = useState<File | null>(null);
  const [categories, setCategories] = useState<CodeOption[]>([]);
  const [saving, setSaving] = useState(false);

  // Approved state — covers both APP (Approved) and INE (In Effect).
  // Used to lock the Reject / Request-Clarification radios so a DDM
  // can't pivot the decision after the FSP has been approved.
  const isApproved = prevDecision === 'APP';
  // "Record" = first decision (no prior). The decision letter is required
  // in this mode; an Edit of an existing decision keeps it optional.
  const isRecordMode = !prevDecision;

  // Re-prefill on every open so re-opening reflects the persisted values
  // rather than whatever the user typed last time and then closed.
  useEffect(() => {
    if (!open) return;
    setDecision(initialDecision);
    setSubmissionDate(value.submissionDate ?? '');
    setDecisionDate(value.decisionDate ?? isoToday());
    setEffectiveDate(value.effectiveDate ?? '');
    setComment(value.comment ?? '');
    setLetterFile(null);
    if (fspId) {
      getAttachmentCategories(fspId)
        .then(setCategories)
        .catch(() => setCategories([]));
    }
  }, [open, initialDecision, value, fspId]);

  const needsEffectiveDate = decision === 'APP';
  const needsComment = decision === 'DFT';

  const submissionMissing = submissionDate.trim() === '';
  const decisionDateMissing = decisionDate.trim() === '';
  const effectiveMissing = needsEffectiveDate && effectiveDate.trim() === '';
  const commentMissing = needsComment && comment.trim() === '';
  const letterMissing = isRecordMode && !letterFile;
  const canSubmit =
    !saving &&
    !submissionMissing &&
    !decisionDateMissing &&
    !effectiveMissing &&
    !commentMissing &&
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
    // 1. Save the decision. On failure keep the modal open for retry.
    try {
      await onSubmit({
        decision,
        submissionDate,
        decisionDate,
        effectiveDate: needsEffectiveDate ? effectiveDate : undefined,
        comment: comment.trim(),
      });
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save DDM decision',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
      setSaving(false);
      return;
    }
    // 2. Decision saved — upload the letter to the FSP attachment list
    //    (the DDM save proc can't carry files). Best-effort: a failure
    //    here shouldn't undo the saved decision.
    if (letterFile) {
      try {
        const category = pickDdmCategory(categories);
        if (!category?.code) throw new Error('No DDM Decision attachment category');
        await uploadFspAttachment(
          fspId,
          category.code,
          letterFile,
          'DDM decision letter',
        );
      } catch {
        display({
          kind: 'warning',
          title: 'Decision saved, but the letter could not be uploaded',
          subtitle: 'Add the decision letter from the Attachments tab.',
          timeout: 0,
        });
      }
    }
    setSaving(false);
    onClose();
  };

  const letterDescription =
    `Supported file types are ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}. `
    + `Max file size is 50 MB.\n`
    + (isRecordMode ? 'Required before saving the decision. ' : '')
    + 'Stored under DDM Decision on the Attachments tab — visible to all users.';

  return (
    <Modal
      open={open}
      modalHeading={prevDecision ? 'Edit DDM decision' : 'Record DDM decision'}
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

        {/* Approved FSPs can only be edited (dates/comment) — the pivot
            to Reject/Clarification is locked. Otherwise, warn about the
            status transition + licensee notification the save triggers. */}
        <InlineNotification
          className="ddm-modal__banner"
          kind="info"
          lowContrast
          hideCloseButton
          title={
            isApproved
              ? 'Approved FSPs can only be edited, not rejected or returned for clarification.'
              : transitionBanner(decision)
          }
          subtitle=""
        />

        <RadioButtonGroup
          legendText="Decision"
          name="ddm-decision"
          valueSelected={decision}
          orientation="vertical"
          onChange={(v) => setDecision(v as DdmDecisionChoice)}
        >
          <RadioButton
            id="ddm-decision-app"
            labelText={DECISION_LABEL.APP}
            value="APP"
            disabled={saving || !isAllowed('APP')}
          />
          {/* Reject + Request Clarification are locked once the FSP is
              approved (APP / INE) and for roles the matrix dashes out. */}
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
                id="ddm-decision-date"
                placeholder="YYYY-MM-DD"
                labelText="Decision date"
                disabled={saving}
                invalid={decisionDateMissing}
                invalidText="Decision date is required."
              />
            </DatePicker>
          </div>

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
                id="ddm-effective-date"
                placeholder="YYYY-MM-DD"
                labelText={needsEffectiveDate ? 'Effective date' : 'Effective date (optional)'}
                disabled={saving || !needsEffectiveDate}
                invalid={effectiveMissing}
                invalidText="Effective date is required for Approve."
              />
            </DatePicker>
          </div>
        </div>

        <div className="ddm-modal__letter">
          <p className="ddm-modal__section-title">Decision letter</p>
          <p className="ddm-modal__letter-desc">{letterDescription}</p>
          <DragDropFileInput
            accept={ACCEPTED_ATTACHMENT_EXTENSIONS}
            file={letterFile}
            invalid={letterMissing}
            disabled={saving}
            onSelect={onLetterSelect}
            onRemove={() => setLetterFile(null)}
          />
        </div>

        <TextArea
          id="ddm-comment"
          labelText={needsComment ? 'Comment' : 'Comment (optional)'}
          helperText={
            needsComment
              ? 'A comment is required when requesting clarification.'
              : undefined
          }
          enableCounter
          maxCount={COMMENT_MAX}
          rows={4}
          value={comment}
          disabled={saving}
          invalid={commentMissing}
          invalidText="Comment is required for Request clarification."
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

export default DdmDecisionEditModal;
