import {
  Button,
  FileUploader,
  Loading,
  Modal,
  Stack,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';

interface StandardRegimeAttachmentModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the picked file. Modal awaits the promise and only
   * closes on success — throw to keep it open for retry. Parent owns
   * the success toast + state refresh; modal surfaces failure errors.
   */
  onSubmit: (file: File) => Promise<void>;
}

/**
 * Standards Regime "Add Attachment" dialog — file-only (no category,
 * unlike the FSP attachments dialog). Same passiveModal + sm size +
 * custom Cancel/Save action footer as the other fsp-species-modal
 * dialogs so the user has a consistent picker experience.
 */
const StandardRegimeAttachmentModal: FC<StandardRegimeAttachmentModalProps> = ({
  open,
  onClose,
  onSubmit,
}) => {
  const { display } = useNotification();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Bumping this remounts the FileUploader — Carbon's filename UI is
  // internal state that we can't otherwise reset between opens.
  const [uploaderResetKey, setUploaderResetKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSelectedFile(null);
    setUploaderResetKey((k) => k + 1);
  }, [open]);

  const closeDialog = () => {
    if (uploading) return;
    onClose();
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelectedFile(file ?? null);
  };

  const submit = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      await onSubmit(selectedFile);
      setSelectedFile(null);
      setUploaderResetKey((k) => k + 1);
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to add attachment',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      modalHeading="Add Attachment"
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <Stack gap={5} className="fsp-species-modal__form">
        <FileUploader
          key={`std-att-${uploaderResetKey}`}
          labelTitle="File *"
          labelDescription="Max 50 MB."
          buttonLabel="Browse"
          filenameStatus="edit"
          multiple={false}
          onChange={onFileChange}
          onDelete={() => setSelectedFile(null)}
        />
      </Stack>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={uploading} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={uploading || !selectedFile}
          renderIcon={uploading ? UploadingIcon : undefined}
          onClick={() => void submit()}
        >
          {uploading ? 'Uploading…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
};

// Same Carbon spinner shape as AttachmentsTab / BgcZoneSearchModal so
// every dialog Save shows the identical in-flight affordance.
const UploadingIcon = () => <Loading small withOverlay={false} description="" />;

export default StandardRegimeAttachmentModal;
