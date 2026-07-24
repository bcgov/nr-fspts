import { Button, Loading, Stack, TextArea } from '@carbon/react';
import { type FC, useEffect, useMemo, useState } from 'react';

import DragDropFileInput from '@/components/DragDropFileInput';
import { Modal } from '@/components/Modal';
import { useNotification } from '@/context/notification/useNotification';
import { safeErrorMessage } from '@/lib/errorMessage';
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  hasAcceptedAttachmentExtension,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILENAME_LEN,
} from '@/lib/attachmentConstraints';

const DESCRIPTION_MAX = 120;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Stocking standard id — rendered in the subtitle + drives copy. */
  standardId: string;
  /**
   * Called with the picked file + description once both pass validation.
   * Modal awaits the promise and only closes on success — throw to keep
   * it open for retry. The parent owns the success toast + state refresh.
   */
  onSubmit: (file: File, description: string) => Promise<void>;
}

// Per-file validation with the exact design copy. Returns the message
// for the first violated rule, or null when the file is acceptable.
const fileProblem = (file: File | null): string | null => {
  if (!file) return 'Please upload at least one file';
  if (!hasAcceptedAttachmentExtension(file.name)) {
    return 'File type not supported. Upload a .pdf, .doc, or .docx file.';
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return 'File exceeds size limit. Max file size is 50 MB. '
      + 'Select a smaller file and try again.';
  }
  if (file.name.length > MAX_ATTACHMENT_FILENAME_LEN) {
    return 'File name too long. Use 50 characters or fewer, including the extension.';
  }
  return null;
};

// Inline spinner sized for the Save button's icon slot while uploading.
const UploadingIcon = () => <Loading small withOverlay={false} description="" />;

/**
 * "Add attachment" dialog for a stocking standard's Attachments tab.
 * Richer than the FSP attachments dialog: no category (attachments hang
 * off the standard, not a type), a required Description with a live
 * counter, and inline per-file validation matching the design copy.
 */
const StandardRegimeAttachmentModal: FC<Props> = ({
  open,
  onClose,
  standardId,
  onSubmit,
}) => {
  const { display } = useNotification();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  // Reveal the required-field errors ("please upload a file", "description
  // is required") only after a submit attempt; the file type/size/name
  // errors surface live the moment an invalid file is picked.
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setDescription('');
    setShowValidation(false);
    setUploading(false);
  }, [open]);

  // A file was picked, so any file-level problem (type/size/name) is
  // shown live. The "no file" case only appears after a submit attempt.
  const fileError = useMemo(() => {
    if (!file) return showValidation ? 'Please upload at least one file' : null;
    return fileProblem(file);
  }, [file, showValidation]);

  const descriptionError =
    showValidation && !description.trim() ? 'Description is required' : null;

  const closeDialog = () => {
    if (uploading) return;
    onClose();
  };

  const submit = async () => {
    // Reveal every outstanding required-field error on the attempt.
    if (!file || fileProblem(file) || !description.trim()) {
      setShowValidation(true);
      return;
    }
    setUploading(true);
    try {
      await onSubmit(file, description.trim());
      onClose();
    } catch (e) {
      // Keep the dialog open for retry; surface a sanitised message.
      display({
        kind: 'error',
        title: 'Failed to add attachment',
        subtitle: safeErrorMessage(e, 'The file could not be uploaded. Please try again.'),
        timeout: 9000,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      modalLabel={`Stocking standard ${standardId}`}
      modalHeading="Add attachment"
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <Stack gap={5} className="fsp-species-modal__form">
        <p className="fsp-species-modal__subtitle">All fields are required.</p>
        <DragDropFileInput
          label="Upload file"
          helperText={
            'Supported file types are .pdf, .doc, .docx. '
            + 'Max file size is 50 MB. Max file name is 50 characters.'
          }
          accept={ACCEPTED_ATTACHMENT_EXTENSIONS}
          file={file}
          invalid={!!fileError}
          invalidText={fileError ?? undefined}
          disabled={uploading}
          onSelect={(f) => setFile(f)}
          onRemove={() => setFile(null)}
        />
        <TextArea
          id="std-attachment-description"
          labelText="Description"
          enableCounter
          maxCount={DESCRIPTION_MAX}
          rows={3}
          value={description}
          invalid={!!descriptionError}
          invalidText={descriptionError ?? undefined}
          disabled={uploading}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Stack>
      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={uploading} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          // Disabled while a live file-level problem is showing or a file
          // is uploading; the required-empty cases reveal their errors on
          // click instead so the button never dead-ends.
          disabled={uploading || !!(file && fileProblem(file))}
          renderIcon={uploading ? UploadingIcon : undefined}
          onClick={() => void submit()}
        >
          {uploading ? 'Adding…' : 'Add attachment'}
        </Button>
      </div>
    </Modal>
  );
};

export default StandardRegimeAttachmentModal;
