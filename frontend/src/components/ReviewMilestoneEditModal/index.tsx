import {
  Button,
  Loading,
  Modal,
  Stack,
  TextArea,
  Toggle,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import type { FspReviewItem } from '@/services/fspSearch';

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

/**
 * Single dialog for editing one of the five review milestones (FNR /
 * RS / ORS / DDM / OTHER). Backs the per-row Edit button on the Review
 * Details tile in the Workflow tab — saves through SAVE_REVIEW which
 * routes to fsp_common_db.fsp_milestone_comment_save.
 *
 * <p>Legacy server-side rule: when milestone is "Other" and Completed
 * is Y, a non-blank comment is required. We enforce client-side too so
 * the user gets feedback before the proc round-trip.
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
      // Title carries the milestone label so the duplicate "Milestone:
      // …" line that used to sit at the top of the form can go away.
      modalHeading={`Edit ${value.label}`}
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form">
        {/* Stack with gap=6 gives roughly 1.5rem (Carbon spacing-06)
            between the Toggle and the TextArea — the previous
            no-wrapper layout left them stuck together because Carbon's
            Toggle ships with no bottom margin. */}
        <Stack gap={6}>
          <Toggle
            id="review-completed-toggle"
            labelText="Status"
            labelA="Pending"
            labelB="Completed"
            toggled={completed}
            disabled={saving}
            onToggle={(value) => setCompleted(value)}
          />
          <TextArea
            id="review-comment"
            labelText={isOther ? 'Comment *' : 'Comment'}
            helperText={
              isOther && completed
                ? 'A comment is required when marking "Other" as complete.'
                : 'Optional — up to 4000 characters.'
            }
            maxLength={4000}
            rows={6}
            value={comment}
            disabled={saving}
            invalid={otherCommentMissing}
            invalidText="Comment is required for the 'Other' milestone when marked Completed."
            onChange={(e) => setComment(e.target.value)}
          />
          {(value.entryUserId || value.entryTimestamp) && (
            <p className="fsp-info__placeholder" style={{ margin: 0 }}>
              Last updated by <strong>{value.entryUserId ?? '—'}</strong>{' '}
              on <strong>{value.entryTimestamp ?? '—'}</strong>.
            </p>
          )}
        </Stack>
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
