import { Button, Loading, Modal } from '@carbon/react';
import { useState, type FC, type ReactNode } from 'react';

import { useNotification } from '@/context/notification/useNotification';

interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  /** Modal heading — short imperative ("Convert to Multi-Layer"). */
  heading: string;
  /** Body content. Plain text works; ReactNode for richer prompts. */
  children: ReactNode;
  /** Primary button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Secondary (cancel) button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Toggles Carbon's red "danger" primary style for destructive actions. */
  danger?: boolean;
  /** Toast error title shown when onConfirm throws. */
  errorTitle?: string;
  /**
   * Async confirm handler. Modal awaits the promise and only closes on
   * success — throw to keep the modal open for retry. Same contract as
   * the other dialog Save buttons.
   */
  onConfirm: () => Promise<void> | void;
}

/**
 * Carbon-based confirm dialog. Replaces ad-hoc `window.confirm()` so
 * the look matches the rest of the FSP dialogs and the user can see
 * progress (button spinner + label flip) during async confirms.
 */
const ConfirmationModal: FC<ConfirmationModalProps> = ({
  open,
  onClose,
  heading,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  errorTitle = 'Action failed',
  onConfirm,
}) => {
  const { display } = useNotification();
  const [busy, setBusy] = useState(false);

  const closeDialog = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: errorTitle,
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setBusy(false);
    }
  };

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
      <div className="fsp-species-modal__form">{children}</div>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={busy} onClick={closeDialog}>
          {cancelLabel}
        </Button>
        <Button
          kind={danger ? 'danger' : 'primary'}
          disabled={busy}
          renderIcon={busy ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {busy ? `${confirmLabel}…` : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};

// Same Carbon spinner shape as the other dialog Save buttons.
const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default ConfirmationModal;
