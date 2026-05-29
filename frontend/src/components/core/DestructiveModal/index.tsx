import { Button } from '@carbon/react';
import type { FC, ReactNode } from 'react';

import { Modal } from '@/components/Modal';

import './destructive-modal.scss';

export type DestructiveModalProps = {
  /** Controls whether the modal is open. */
  open: boolean;
  /** Title of the modal (e.g., "Delete designate?"). */
  title: string;
  /**
   * Warning message describing the destructive action and its
   * consequences. Associated with the destructive button via
   * `aria-describedby` for accessibility.
   */
  message: string | ReactNode;
  /** Text for the primary (destructive) action button. */
  confirmButtonText?: string;
  /** Text for the secondary (cancel) action button. */
  cancelButtonText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables both buttons while the confirm action is in flight. */
  loading?: boolean;
  /** Modal width. Defaults to `sm` — confirmation dialogs are short. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
};

/**
 * Reusable confirmation modal for destructive actions (delete, remove,
 * etc.). Mirrors nr-rept's DestructiveModal — Carbon Modal with
 * passive mode, danger-styled primary button, focus-trap + ESC-to-close.
 */
export const DestructiveModal: FC<DestructiveModalProps> = ({
  open,
  title,
  message,
  confirmButtonText = 'Delete',
  cancelButtonText = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
  size = 'sm',
}) => {
  const warningId = 'destructive-modal-warning';

  return (
    <Modal
      open={open}
      modalHeading={title}
      passiveModal
      size={size}
      aria-label={title}
      preventCloseOnClickOutside={loading}
      onRequestClose={onCancel}
    >
      <div className="destructive-modal">
        <p
          id={warningId}
          className="destructive-modal__message"
          aria-live="polite"
          aria-atomic="true"
        >
          {message}
        </p>
      </div>
      <div className="destructive-modal__actions">
        <Button kind="secondary" size="md" onClick={onCancel} disabled={loading}>
          {cancelButtonText}
        </Button>
        <Button
          kind="danger"
          size="md"
          onClick={onConfirm}
          disabled={loading}
          aria-describedby={warningId}
        >
          {confirmButtonText}
        </Button>
      </div>
    </Modal>
  );
};

export default DestructiveModal;
