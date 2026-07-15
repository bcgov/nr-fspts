import {
  Button,
  Loading,
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
import { Modal } from '@/components/Modal';
import { Add, Launch, TrashCan } from '@carbon/icons-react';
import { type FC, useEffect, useMemo, useState } from 'react';

import DragDropFileInput from '@/components/DragDropFileInput';
import EmptyState from '@/components/EmptyState/EmptyState';
import { useAuth } from '@/context/auth/useAuth';
import { useNotification } from '@/context/notification/useNotification';
import { canAttachDecisionLetter, canEditAttachments } from '@/routes/access';
import { findDecisionLetterCategory } from '@/lib/attachmentCategories';
import {
  type CodeOption,
  deleteFspAttachment,
  fetchFspAttachmentBlob,
  type FspAttachmentRow,
  getAttachmentCategories,
  getFspAttachments,
  uploadFspAttachment,
} from '@/services/fspSearch';

type SortDir = 'ASC' | 'DESC';

// Amendment numbers arrive as strings ("0", "1", …); parse for a numeric
// sort so 10 orders after 9. Non-numeric/blank rows sink to the bottom.
const parseAmendment = (value: string | null): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : -1;
};

interface Props {
  fspId: string;
  /** Parent-bumped counter that forces a refetch on Submit/Extend/etc. */
  refreshKey?: number;
  /**
   * Current FSP status code — gates the Add Attachment button via
   * canEditAttachments (matrix B2): Admin any status; Submitter Draft;
   * Decision Maker on SUB/OHS; Reviewer on SUB; read-only otherwise.
   */
  fspStatusCode?: string | null;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Amendment 0 is the original plan — render "Original" rather than "0".
const formatAmendment = (value: string | null | undefined): string => {
  if (value == null || value.trim() === '') return '—';
  return Number(value) === 0 ? 'Original' : value;
};

// Thin-stroke "document + plus" glyph for the empty state. Carbon's filled
// DocumentAdd reads too heavy at pictogram size; a stroked SVG with
// non-scaling-stroke keeps the lines a crisp ~1.5px at any rendered size.
const EmptyDocumentAddIcon = () => (
  <svg
    width="112"
    height="112"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path
      d="M18 4H8a1 1 0 0 0-1 1v22a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V11z"
      vectorEffect="non-scaling-stroke"
    />
    <path d="M18 4v7h7" vectorEffect="non-scaling-stroke" />
    <path d="M16 15v8M12 19h8" vectorEffect="non-scaling-stroke" />
  </svg>
);

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
  const canEdit = canEditAttachments(user, fspStatusCode);
  const [rows, setRows] = useState<FspAttachmentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Default to newest amendment first, with the sort indicator shown on
  // the Amendment column; clicking the header toggles the direction.
  const [sortDir, setSortDir] = useState<SortDir>('DESC');
  // Attachment queued for deletion (drives the confirm dialog); null when
  // no confirmation is pending.
  const [pendingDelete, setPendingDelete] = useState<FspAttachmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add-attachment dialog state.
  const [modalOpen, setModalOpen] = useState(false);
  const [categories, setCategories] = useState<CodeOption[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [selectedTypeCode, setSelectedTypeCode] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  // Add attachment stays enabled at all times; on click we surface the
  // required-field errors instead of pre-disabling the button.
  const [showValidation, setShowValidation] = useState(false);

  const { display } = useNotification();

  // Categories offered in the Add-attachment dialog. The DDM decision-letter
  // category is a ministry review document — hide it from roles that may not
  // file one (only Administrator / Decision Maker / Reviewer keep it). Uses
  // the same category matcher the DDM decision modal files the letter under.
  const visibleCategories = useMemo(() => {
    if (canAttachDecisionLetter(user)) return categories;
    const decisionLetter = findDecisionLetterCategory(categories);
    if (!decisionLetter) return categories;
    return categories.filter((c) => c.code !== decisionLetter.code);
  }, [categories, user]);

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

  // Open an attachment inline in a new browser tab. The tab is opened
  // synchronously on the click (pre-fetch) so pop-up blockers don't reject
  // it; we then swap in the blob URL once the authenticated fetch resolves.
  const handleView = async (attachmentId: string, fileName: string | null) => {
    if (viewingId) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      display({
        kind: 'error',
        title: 'Pop-up blocked',
        subtitle: 'Allow pop-ups for this site to view attachments.',
        timeout: 7000,
      });
      return;
    }
    setViewingId(attachmentId);
    try {
      const blob = await fetchFspAttachmentBlob(fspId, attachmentId, fileName);
      // Object URL is left un-revoked — the new tab needs it while it
      // loads; the browser releases it when that tab closes.
      popup.location.href = URL.createObjectURL(blob);
    } catch (e) {
      popup.close();
      display({
        kind: 'error',
        title: 'Could not open attachment',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 7000,
      });
    } finally {
      setViewingId(null);
    }
  };

  const confirmDelete = async () => {
    const attachmentId = pendingDelete?.fspAttachmentId;
    if (!attachmentId) return;
    setDeleting(true);
    try {
      await deleteFspAttachment(fspId, attachmentId);
      setPendingDelete(null);
      refreshList();
      display({
        kind: 'success',
        title: 'Attachment deleted.',
        subtitle: pendingDelete?.attachmentName ?? undefined,
        timeout: 6000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: 'Delete failed',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setDeleting(false);
    }
  };

  const resetDialog = () => {
    setSelectedTypeCode('');
    setSelectedFile(null);
    setDescription('');
    setShowValidation(false);
  };

  const openAddDialog = () => {
    resetDialog();
    setModalOpen(true);
    if (categories.length === 0 && !categoriesLoading) {
      setCategoriesLoading(true);
      getAttachmentCategories(fspId)
        .then(setCategories)
        .catch((e) => {
          // A genuine empty list resolves fine and falls through to the
          // "No categories available" dropdown state. Only an actual
          // failure (e.g. the backend can't read the attachment-type
          // table) lands here — surface it instead of masking it as an
          // empty dropdown, which is indistinguishable to the user.
          setCategories([]);
          display({
            kind: 'error',
            title: "Couldn't load attachment categories",
            subtitle:
              e instanceof Error
                ? e.message
                : 'The category list could not be retrieved. Please try again.',
            timeout: 0,
          });
        })
        .finally(() => setCategoriesLoading(false));
    }
  };

  const closeDialog = () => {
    if (uploading) return;
    setModalOpen(false);
    resetDialog();
  };

  // Validate the picked file against the shared extension/size/name
  // constraints before accepting it into the form.
  const onFileSelect = (file: File) => {
    const problem = validateAttachmentFile(file);
    if (problem) {
      display({ kind: 'error', ...problem, timeout: 0 });
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const submitUpload = async () => {
    // Category + File are both mandatory. Rather than disabling the button,
    // reveal the inline required-field errors when either is missing.
    if (!selectedTypeCode || !selectedFile) {
      setShowValidation(true);
      return;
    }
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

  // Frontend sort on Amendment (numeric), defaulting to descending so the
  // most recent amendment's attachments sit at the top.
  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const diff = parseAmendment(a.fspAmendmentNumber) - parseAmendment(b.fspAmendmentNumber);
      return sortDir === 'DESC' ? -diff : diff;
    });
  }, [rows, sortDir]);

  if (loading && !rows) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading attachments…" withOverlay={false} />
      </div>
    );
  }
  if (error) return <p className="fsp-info__error">{error}</p>;

  return (
    <>
      {sorted.length === 0 ? (
        <EmptyState
          icon={<EmptyDocumentAddIcon />}
          title="No attachments for this FSP"
          body="Add the FSP legal documents, maps of FDUs, and decision letters for this FSP."
          action={
            canEdit ? (
              <Button kind="primary" renderIcon={Add} onClick={openAddDialog}>
                Add attachment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {canEdit && (
            <header className="fsp-info__tile-header fsp-info__tile-header--tab">
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Add}
                onClick={openAddDialog}
                style={{ marginInlineStart: 'auto' }}
              >
                Add attachment
              </Button>
            </header>
          )}
          <div className="bordered-table">
          <TableContainer>
            <Table size="md" useZebraStyles>
              <TableHead>
                <TableRow>
                  <TableHeader>Category</TableHeader>
                  <TableHeader>File</TableHeader>
                  <TableHeader>Description</TableHeader>
                  <TableHeader>Size</TableHeader>
                  <TableHeader
                    isSortable
                    isSortHeader
                    sortDirection={sortDir}
                    onClick={() => setSortDir((d) => (d === 'DESC' ? 'ASC' : 'DESC'))}
                  >
                    Amendment
                  </TableHeader>
                  <TableHeader>Consolidated</TableHeader>
                  <TableHeader>Actions</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((r, i) => {
                  const attachmentId = r.fspAttachmentId;
                  return (
                    <TableRow key={attachmentId ?? `row-${i}`}>
                      <TableCell>{dash(r.category)}</TableCell>
                      <TableCell>{dash(r.attachmentName)}</TableCell>
                      <TableCell>{dash(r.attachmentDescription)}</TableCell>
                      <TableCell>{dash(r.attachmentSize)}</TableCell>
                      <TableCell>{formatAmendment(r.fspAmendmentNumber)}</TableCell>
                      <TableCell>{r.consolidatedInd === 'Y' ? 'Yes' : 'No'}</TableCell>
                      <TableCell>
                        {attachmentId ? (
                          <div className="fsp-info__row-actions">
                            <Button
                              kind="ghost"
                              size="sm"
                              renderIcon={Launch}
                              disabled={viewingId === attachmentId}
                              onClick={() => void handleView(attachmentId, r.attachmentName)}
                            >
                              View
                            </Button>
                            {canEdit && (
                              <Button
                                kind="danger--ghost"
                                size="sm"
                                renderIcon={TrashCan}
                                onClick={() => setPendingDelete(r)}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          </div>
        </>
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
          <p className="fsp-species-modal__subtitle">
            All fields are required unless marked optional.
          </p>
          <Select
            id="attachment-category"
            labelText="Category"
            value={selectedTypeCode}
            invalid={showValidation && !selectedTypeCode}
            invalidText="Category is required."
            disabled={uploading || categoriesLoading || visibleCategories.length === 0}
            onChange={(e) => setSelectedTypeCode(e.target.value)}
          >
            <SelectItem
              value=""
              text={
                categoriesLoading
                  ? 'Loading…'
                  : visibleCategories.length === 0
                    ? 'No categories available'
                    : '— Select category —'
              }
            />
            {visibleCategories.map((c) => (
              <SelectItem
                key={c.code ?? ''}
                value={c.code ?? ''}
                text={c.description ?? c.code ?? ''}
              />
            ))}
          </Select>
          <DragDropFileInput
            label="File"
            helperText={
              `Allowed: ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}. `
              + `File name max ${MAX_ATTACHMENT_FILENAME_LEN} chars. Max 50 MB.`
            }
            invalid={showValidation && !selectedFile}
            invalidText="File is required."
            file={selectedFile}
            // The accept list hands the OS file picker an extension
            // allow-list; re-checked in onFileSelect because drag-and-drop
            // can bypass the picker entirely.
            accept={ACCEPTED_ATTACHMENT_EXTENSIONS}
            disabled={uploading}
            onSelect={onFileSelect}
            onRemove={() => setSelectedFile(null)}
          />
          <TextArea
            id="attachment-description"
            labelText="Description (optional)"
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
            disabled={uploading}
            renderIcon={uploading ? UploadingIcon : undefined}
            onClick={() => void submitUpload()}
          >
            {uploading ? 'Adding…' : 'Add attachment'}
          </Button>
        </div>
      </Modal>

      {/* Delete confirmation — irreversible, so gate it behind a danger
          dialog rather than deleting straight from the row button. Passive
          modal + custom footer so the buttons match the Add dialog's
          compact Cancel/primary pair (Carbon's built-in footer renders the
          oversized full-width buttons). */}
      <Modal
        open={pendingDelete !== null}
        passiveModal
        size="sm"
        className="fsp-species-modal fsp-species-modal--tight"
        modalHeading="Delete attachment"
        onRequestClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        preventCloseOnClickOutside
      >
        <p>
          Permanently delete{' '}
          <strong>{pendingDelete?.attachmentName ?? 'this attachment'}</strong>? This
          cannot be undone.
        </p>
        <div className="fsp-species-modal__actions">
          <Button
            kind="secondary"
            disabled={deleting}
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </Button>
          <Button
            kind="danger"
            disabled={deleting}
            onClick={() => void confirmDelete()}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </>
  );
};

export default AttachmentsTab;
