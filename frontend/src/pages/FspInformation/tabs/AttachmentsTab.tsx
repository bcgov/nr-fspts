import {
  Button,
  DataTable,
  FileUploader,
  Loading,
  Modal,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from '@carbon/react';
import { Add, Download } from '@carbon/icons-react';
import { type FC, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth/useAuth';
import { useNotification } from '@/context/notification/useNotification';
import { canEditFsp } from '@/routes/access';
import {
  type CodeOption,
  downloadFspAttachment,
  type FspAttachmentRow,
  getAttachmentCategories,
  getFspAttachments,
  uploadFspAttachment,
} from '@/services/fspSearch';

interface Props {
  fspId: string;
  /** Parent-bumped counter that forces a refetch on Submit/Extend/etc. */
  refreshKey?: number;
  /**
   * Current FSP status code — gates the Add Attachment button via
   * canEditFsp. Submitter-only users on SUB and View-Only on any
   * status get a read-only tab.
   */
  fspStatusCode?: string | null;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const HEADERS = [
  { key: 'category', header: 'Category' },
  { key: 'attachmentName', header: 'File' },
  { key: 'attachmentDescription', header: 'Description' },
  { key: 'attachmentSize', header: 'Size' },
  { key: 'fspAmendmentNumber', header: 'Amendment' },
  { key: 'consolidatedInd', header: 'Consolidated' },
  // Synthetic action column — Carbon's built-in DataTable sort tries
  // to sort by cell value (empty for actions), so opt it out via
  // isSortable=false on this header alone.
  { key: 'actions', header: '', isSortable: false },
];

// Shared attachment constraints (extension allow-list, 50-char
// filename cap, 50 MB size cap) live in @/lib/attachmentConstraints
// so every upload site enforces them identically.
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_FILENAME_LEN,
  validateAttachmentFile,
} from '@/lib/attachmentConstraints';

// Inline spinner sized to fit the Save button's icon slot while the
// upload is in flight. withOverlay={false} suppresses Carbon's
// default full-viewport dim layer; `small` matches Button's icon area.
const UploadingIcon = () => <Loading small withOverlay={false} description="" />;

const AttachmentsTab: FC<Props> = ({ fspId, refreshKey, fspStatusCode }) => {
  const { user } = useAuth();
  // Submitter-only on SUB and View-Only never see add affordances.
  // Other roles fall through to existing behaviour.
  const canEdit = canEditFsp(user, fspStatusCode);
  const [rows, setRows] = useState<FspAttachmentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Add-attachment dialog state.
  const [modalOpen, setModalOpen] = useState(false);
  const [categories, setCategories] = useState<CodeOption[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [selectedTypeCode, setSelectedTypeCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  // FileUploader is uncontrolled; bumping this key forces a remount
  // when the user clears or after a successful save.
  const [uploaderResetKey, setUploaderResetKey] = useState(0);
  const [uploading, setUploading] = useState(false);

  const { display } = useNotification();

  const refreshList = () => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspAttachments(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Attachments load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const cleanup = refreshList();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fspId, refreshKey]);

  const handleDownload = async (attachmentId: string, fallbackName: string) => {
    if (downloadingId) return;
    setDownloadingId(attachmentId);
    try {
      await downloadFspAttachment(fspId, attachmentId, fallbackName);
    } catch (e) {
      display({
        kind: 'error',
        title: 'Download failed',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 7000,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const resetDialog = () => {
    setSelectedTypeCode('');
    setSelectedFile(null);
    setDescription('');
    setUploaderResetKey((k) => k + 1);
  };

  const openAddDialog = () => {
    resetDialog();
    setModalOpen(true);
    if (categories.length === 0 && !categoriesLoading) {
      setCategoriesLoading(true);
      getAttachmentCategories(fspId)
        .then(setCategories)
        .catch(() => setCategories([]))
        .finally(() => setCategoriesLoading(false));
    }
  };

  const closeDialog = () => {
    if (uploading) return;
    setModalOpen(false);
    resetDialog();
  };

  // Carbon's FileUploader.onChange signature varies between versions —
  // same shim used on the XML submission page.
  const filesFromCarbon = (
    event: React.SyntheticEvent<HTMLElement>,
    data?: { addedFiles?: Array<{ file: File }> },
  ): File[] => {
    if (data?.addedFiles?.length) {
      return data.addedFiles.map((f) => f.file).filter(Boolean);
    }
    const input = event.currentTarget as unknown as HTMLInputElement;
    if (input?.files?.length) return Array.from(input.files);
    const target = event.target as unknown as HTMLInputElement;
    if (target?.files?.length) return Array.from(target.files);
    return [];
  };

  const onFileChange = (
    event: React.SyntheticEvent<HTMLElement>,
    data?: { addedFiles?: Array<{ file: File }> },
  ) => {
    const file = filesFromCarbon(event, data)[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const problem = validateAttachmentFile(file);
    if (problem) {
      display({ kind: 'error', ...problem, timeout: 0 });
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const submitUpload = async () => {
    if (!selectedTypeCode || !selectedFile) return;
    setUploading(true);
    try {
      await uploadFspAttachment(fspId, selectedTypeCode, selectedFile, description);
      setModalOpen(false);
      resetDialog();
      refreshList();
      display({
        kind: 'success',
        title: 'Attachment added.',
        subtitle: selectedFile.name,
        timeout: 6000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: 'Upload failed',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading && !rows) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading attachments…" withOverlay={false} />
      </div>
    );
  }
  if (error) return <p className="fsp-info__error">{error}</p>;

  const tableRows = (rows ?? []).map((r, i) => ({
    id: r.fspAttachmentId ?? `row-${i}`,
    category: dash(r.category),
    attachmentName: dash(r.attachmentName),
    attachmentDescription: dash(r.attachmentDescription),
    attachmentSize: dash(r.attachmentSize),
    fspAmendmentNumber: dash(r.fspAmendmentNumber),
    consolidatedInd: r.consolidatedInd === 'Y' ? 'Yes' : 'No',
    actions: '',
    __attachmentId: r.fspAttachmentId,
    __fileName: r.attachmentName,
  }));

  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <h2 className="fsp-info__section-title">Attachments</h2>
        {canEdit && (
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Add}
            onClick={openAddDialog}
          >
            Add attachment
          </Button>
        )}
      </header>
      {tableRows.length === 0 ? (
        <p className="fsp-info__placeholder">No attachments on this FSP.</p>
      ) : (
        <div className="bordered-table">
          <DataTable rows={tableRows} headers={HEADERS} isSortable>
            {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()} size="md" useZebraStyles>
                  <TableHead>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHeader {...getHeaderProps({ header: h })} key={h.key}>
                          {h.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {r.map((row) => {
                      const source = tableRows.find((t) => t.id === row.id);
                      const attachmentId = source?.__attachmentId ?? null;
                      const fallbackName = source?.__fileName ?? row.id;
                      const isDownloading = downloadingId === attachmentId;
                      return (
                        <TableRow {...getRowProps({ row })} key={row.id}>
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'actions') {
                              return (
                                <TableCell key={cell.id}>
                                  {attachmentId ? (
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      renderIcon={Download}
                                      iconDescription={
                                        isDownloading ? 'Downloading…' : 'Download'
                                      }
                                      hasIconOnly
                                      disabled={isDownloading}
                                      onClick={() =>
                                        void handleDownload(attachmentId, fallbackName)
                                      }
                                    />
                                  ) : null}
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={cell.id}>{cell.value as string}</TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </div>
      )}

      {/* Add-attachment dialog — same shape as the species composer
          modal: passive footer, sm size, custom Cancel/Save actions
          beneath a vertically stacked form. */}
      <Modal
        open={modalOpen}
        modalHeading="Add attachment"
        passiveModal
        size="sm"
        className="fsp-species-modal"
        onRequestClose={closeDialog}
        preventCloseOnClickOutside
      >
        <Stack gap={5} className="fsp-species-modal__form">
          <Select
            id="attachment-category"
            labelText="Category *"
            value={selectedTypeCode}
            disabled={uploading || categoriesLoading || categories.length === 0}
            onChange={(e) => setSelectedTypeCode(e.target.value)}
          >
            <SelectItem
              value=""
              text={
                categoriesLoading
                  ? 'Loading…'
                  : categories.length === 0
                    ? 'No categories available'
                    : '— Select category —'
              }
            />
            {categories.map((c) => (
              <SelectItem
                key={c.code ?? ''}
                value={c.code ?? ''}
                text={c.description ?? c.code ?? ''}
              />
            ))}
          </Select>
          <FileUploader
            key={`att-${uploaderResetKey}`}
            labelTitle="File *"
            labelDescription={
              `Allowed: ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}. `
              + `File name max ${MAX_ATTACHMENT_FILENAME_LEN} chars. Max 50 MB.`
            }
            buttonLabel="Browse"
            filenameStatus="edit"
            multiple={false}
            // The accept array hands the OS file picker an extension
            // allow-list so the user can't even see disallowed files
            // in the dialog. Re-checked in onFileChange because
            // drag-and-drop can bypass the picker entirely.
            accept={[...ACCEPTED_ATTACHMENT_EXTENSIONS]}
            onChange={onFileChange}
            onDelete={() => setSelectedFile(null)}
          />
          <TextArea
            id="attachment-description"
            labelText="Description"
            placeholder="Optional — short note about this attachment."
            maxLength={2000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={uploading}
          />
        </Stack>
        <div className="fsp-species-modal__actions">
          <Button kind="secondary" disabled={uploading} onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={uploading || !selectedTypeCode || !selectedFile}
            renderIcon={uploading ? UploadingIcon : undefined}
            onClick={() => void submitUpload()}
          >
            {uploading ? 'Uploading…' : 'Save'}
          </Button>
        </div>
      </Modal>
    </section>
  );
};

export default AttachmentsTab;
