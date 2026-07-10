import { Button, Checkbox, Loading, Modal, TextArea } from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import type { FspReviewItem } from '@/services/fspSearch';
import './review-milestone-modal.scss';

interface ReviewMilestoneEditModalProps {
  open: boolean;
  /** The milestone row to edit. Null only when the modal is closed. */
  value: FspReviewItem | null;
  onClose: () => void;
  /**
   * Submit handler. Modal awaits and only closes on success — throw to
   * keep open for retry. Receives the editable payload (completed flag
   * + comment); milestoneType is implicit in {@code value.code}.
   */
  onSubmit: (payload: { completedInd: 'Y' | 'N'; comment: string }) => Promise<void>;
}

const COMMENT_MAX = 2000;

const isBlank = (v: string | null | undefined): boolean =>
  v == null || v.trim() === '';

// A milestone is "recorded" once it has a completion flag, a reviewer, or
// a comment — drives the Add vs Edit dialog title (mirrors the tile).
const hasRecord = (item: FspReviewItem): boolean =>
  item.completedInd === 'Y' || !isBlank(item.entryUserId) || !isBlank(item.comment);

/**
 * Single dialog for editing one of the five review milestones (FNR /
 * RS / ORS / DDM / OTHER). Backs the per-row Add/Edit record button on
 * the Review Details tile in the Workflow tab — saves through SAVE_REVIEW
 * which routes to fsp_common_db.fsp_milestone_comment_save.
 *
 * <p>Legacy server-side rule: when milestone is "Other" and Completed is
 * Y, a non-blank comment is required. We enforce client-side too so the
 * user gets feedback before the proc round-trip.
 */
const ReviewMilestoneEditModal: FC<ReviewMilestoneEditModalProps> = ({
  open,
  value,
  onClose,
  onSubmit,
}) => {
  const { display } = useNotification();
  const [completed, setCompleted] = useState(false);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset/prefill on every open. The `value` reference flips with each
  // row click; effect runs on open so re-opening on a different row
  // shows that row's stamps + comment rather than the previous one.
  useEffect(() => {
    if (!open) return;
    setCompleted(value?.completedInd === 'Y');
    setComment(value?.comment ?? '');
  }, [open, value]);

  if (!value) return null;
  const isOther = value.code === 'OTHER';
  const trimmedComment = comment.trim();
  const otherCommentMissing = isOther && completed && trimmedComment === '';
  const canSubmit = !saving && !otherCommentMissing;
  const verb = hasRecord(value) ? 'Edit' : 'Add';

  const closeDialog = () => {
    if (saving) return;
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({
        completedInd: completed ? 'Y' : 'N',
        comment: trimmedComment,
      });
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save review milestone',
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
      modalHeading={`${verb} record: ${value.label}`}
      passiveModal
      size="sm"
      className="fsp-species-modal review-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form review-modal__body">
        <p className="fsp-species-modal__subtitle">
          All fields are required unless marked optional.
        </p>

        <div className="review-modal__field">
          <span className="review-modal__label">Review status</span>
          <Checkbox
            id="review-completed"
            labelText="Mark as complete"
            checked={completed}
            disabled={saving}
            onChange={(_e, { checked }) => setCompleted(checked)}
          />
        </div>

        <TextArea
          id="review-comment"
          labelText={
            isOther ? 'Comment or rationale' : 'Comment or rationale (optional)'
          }
          helperText={
            isOther && completed
              ? 'A comment is required when marking "Other" as complete.'
              : undefined
          }
          enableCounter
          maxCount={COMMENT_MAX}
          rows={6}
          value={comment}
          disabled={saving}
          invalid={otherCommentMissing}
          invalidText="Comment is required for the 'Other' milestone when marked complete."
          onChange={(e) => setComment(e.target.value)}
        />

        {(value.entryUserId || value.entryTimestamp) && (
          <p className="review-modal__audit">
            Last updated by <strong>{value.entryUserId ?? '—'}</strong> on{' '}
            <strong>{value.entryTimestamp ?? '—'}</strong>.
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

export default ReviewMilestoneEditModal;
