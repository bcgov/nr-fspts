import {
  Button,
  DatePicker,
  DatePickerInput,
  Loading,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
  TextArea,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { useEffect, useState, type FC } from 'react';

import DragDropFileInput from '@/components/DragDropFileInput';
import { useNotification } from '@/context/notification/useNotification';
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  validateAttachmentFile,
} from '@/lib/attachmentConstraints';
import {
  createExtensionRequest,
  getAttachmentCategories,
  uploadFspAttachment,
  type CodeOption,
  type FspInformation,
} from '@/services/fspSearch';

/**
 * Dialog for the FSP302 "New Extension Request" flow. Captures the
 * proposed new plan term (years/months) OR a new expiry date, optional
 * supporting attachments, and a comment. Posts to
 * {@code POST /v1/fsp/{fspId}/extensions} which routes through
 * {@code FSP_302_EXTENSION_REQUEST.SAVE} → {@code fsp_create_extension}.
 *
 * <p>The extensions API is JSON-only (no file slot), so any attachments
 * the user adds here are uploaded to the FSP's attachment list after the
 * request is created, via the shared attachment endpoint.
 */
interface Props {
  open: boolean;
  fsp: FspInformation | null;
  onClose: () => void;
  /** Called after a successful create; receives the new extension id. */
  onCreated: (extensionId: string | null) => void;
}

const COMMENT_MAX = 4000;
const MAX_FILES = 4;
const MAX_TERM_MONTHS = 5 * 12;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// "2025-12-08 …" → "Dec 8, 2025". Falls back to the raw value if it
// doesn't lead with an ISO date.
const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  const [, y, mo, d] = m;
  const name = MONTHS[Number(mo) - 1];
  return name ? `${name} ${Number(d)}, ${y}` : value;
};

const formatTerm = (
  years: string | null | undefined,
  months: string | null | undefined,
): string => {
  const y = Number(years) || 0;
  const m = Number(months) || 0;
  return `${y} ${y === 1 ? 'year' : 'years'}, ${m} ${m === 1 ? 'month' : 'months'}`;
};

// No category picker in this dialog, so choose the most fitting
// attachment type for an extension letter, falling back to the first
// available category.
const pickCategory = (cats: CodeOption[]): CodeOption | null => {
  const find = (re: RegExp) =>
    cats.find((c) => re.test(`${c.description ?? ''} ${c.code ?? ''}`));
  return (
    find(/extension/i) ??
    find(/letter/i) ??
    find(/legal/i) ??
    find(/support/i) ??
    cats[0] ??
    null
  );
};

const ExtensionRequestModal: FC<Props> = ({ open, fsp, onClose, onCreated }) => {
  const { display } = useNotification();
  const [busy, setBusy] = useState(false);
  const [extendBy, setExtendBy] = useState<'term' | 'expiry'>('term');
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [comment, setComment] = useState('');
  const [categories, setCategories] = useState<CodeOption[]>([]);
  const [errors, setErrors] = useState<{
    term?: string;
    expiry?: string;
    comment?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    setExtendBy('term');
    setYears('');
    setMonths('');
    setExpiryDate('');
    setFiles([]);
    setComment('');
    setErrors({});
    // Attachments piggy-back on the FSP attachment list, so we need a
    // category code to file them under. Fetch the list once per open.
    if (fsp?.fspId) {
      getAttachmentCategories(fsp.fspId)
        .then(setCategories)
        .catch(() => setCategories([]));
    }
  }, [open, fsp?.fspId]);

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const addFiles = (picked: File[]) => {
    setFiles((prev) => {
      const next = [...prev];
      for (const f of picked) {
        if (next.length >= MAX_FILES) {
          display({
            kind: 'warning',
            title: `Up to ${MAX_FILES} files`,
            subtitle: `"${f.name}" was not added.`,
            timeout: 6000,
          });
          break;
        }
        const problem = validateAttachmentFile(f);
        if (problem) {
          display({ kind: 'error', ...problem, timeout: 6000 });
          continue;
        }
        if (next.some((e) => e.name === f.name && e.size === f.size)) continue;
        next.push(f);
      }
      return next;
    });
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (extendBy === 'term') {
      const hasTerm = years.trim() !== '' || months.trim() !== '';
      if (!hasTerm) {
        next.term = 'Enter a new term (years and/or months).';
      } else if (
        (years && !/^\d+$/.test(years)) ||
        (months && !/^\d+$/.test(months))
      ) {
        next.term = 'Years and months must be whole numbers ≥ 0.';
      } else if ((Number(years) || 0) * 12 + (Number(months) || 0) > MAX_TERM_MONTHS) {
        next.term = 'Maximum extension is 5 years.';
      }
    } else if (!expiryDate) {
      next.expiry = 'Choose a new expiry date.';
    }
    if (comment.length > COMMENT_MAX) {
      next.comment = `Max ${COMMENT_MAX} characters.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!fsp || !fsp.fspId) return;
    if (!validate()) return;
    setBusy(true);
    try {
      const result = await createExtensionRequest(fsp.fspId, {
        planTermYears: extendBy === 'term' ? years.trim() || null : null,
        planTermMonths: extendBy === 'term' ? months.trim() || null : null,
        fspExpiryDate: extendBy === 'expiry' ? expiryDate || null : null,
        statusComment: comment.trim() || null,
        revisionCount: fsp.revisionCount,
      });

      // Upload any attachments to the FSP's attachment list (the
      // extensions API can't carry files). A failed upload shouldn't
      // undo the request, so collect failures and warn.
      const failedUploads: string[] = [];
      if (files.length > 0) {
        const category = pickCategory(categories);
        if (!category?.code) {
          failedUploads.push(...files.map((f) => f.name));
        } else {
          for (const f of files) {
            try {
              await uploadFspAttachment(
                fsp.fspId,
                category.code,
                f,
                'Extension request supporting document',
              );
            } catch {
              failedUploads.push(f.name);
            }
          }
        }
      }

      onCreated(result.extensionId);
      onClose();
      if (failedUploads.length > 0) {
        display({
          kind: 'warning',
          title: 'Extension submitted, some attachments failed',
          subtitle: `Could not upload: ${failedUploads.join(', ')}. Add them from the Attachments tab.`,
          timeout: 0,
        });
      } else {
        display({
          kind: 'success',
          title: 'Extension request submitted.',
          subtitle: result.extensionId
            ? `New extension #${result.extensionId}`
            : undefined,
          timeout: 6000,
        });
      }
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to submit extension request',
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
      modalHeading={fsp?.fspId ? `Extend FSP ${fsp.fspId}` : 'Extend FSP'}
      passiveModal
      size="md"
      className="fsp-species-modal ext-modal"
      onRequestClose={closeIfIdle}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form ext-modal__body">
        <p className="ext-modal__intro">
          Request an extension to this plan for up to 5 additional years by
          setting either a new term or a new expiry date.
        </p>

        {/* Read-only context tile (FSP302 "current" details). */}
        <dl className="ext-modal__summary">
          <div className="ext-modal__summary-item">
            <dt className="ext-modal__summary-label">Effective date</dt>
            <dd className="ext-modal__summary-value">
              {formatDate(fsp?.fspPlanStartDate)}
            </dd>
          </div>
          <div className="ext-modal__summary-item">
            <dt className="ext-modal__summary-label">Current term</dt>
            <dd className="ext-modal__summary-value">
              {formatTerm(fsp?.fspPlanTermYears, fsp?.fspPlanTermMonths)}
            </dd>
          </div>
          <div className="ext-modal__summary-item">
            <dt className="ext-modal__summary-label">Current expiry date</dt>
            <dd className="ext-modal__summary-value">
              {formatDate(fsp?.fspExpiryDate ?? fsp?.fspPlanEndDate)}
            </dd>
          </div>
        </dl>

        <div className="ext-modal__section">
          <RadioButtonGroup
            name="ext-extend-by"
            legendText="Extend by"
            valueSelected={extendBy}
            onChange={(v) => setExtendBy(v === 'expiry' ? 'expiry' : 'term')}
            disabled={busy}
          >
            <RadioButton id="ext-by-term" labelText="New term" value="term" />
            <RadioButton
              id="ext-by-expiry"
              labelText="New expiry date"
              value="expiry"
            />
          </RadioButtonGroup>

          {extendBy === 'term' ? (
            <>
              <div className="ext-modal__term-grid">
                <NumberInput
                  id="ext-years"
                  label="Years"
                  min={0}
                  max={5}
                  allowEmpty
                  hideSteppers
                  value={years === '' ? '' : Number(years)}
                  invalid={!!errors.term}
                  invalidText={errors.term ?? ''}
                  disabled={busy}
                  onChange={(_e, { value }) =>
                    setYears(value === '' ? '' : String(value))
                  }
                />
                <NumberInput
                  id="ext-months"
                  label="Months"
                  min={0}
                  max={11}
                  allowEmpty
                  hideSteppers
                  value={months === '' ? '' : Number(months)}
                  disabled={busy}
                  onChange={(_e, { value }) =>
                    setMonths(value === '' ? '' : String(value))
                  }
                />
              </div>
              <p className="ext-modal__hint">
                Maximum 5 years. The expiry date will be calculated from the
                effective date on approval.
              </p>
            </>
          ) : (
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              value={expiryDate || undefined}
              onChange={(dates: Date[]) =>
                setExpiryDate(dates[0] ? toIsoDate(dates[0]) : '')
              }
            >
              <DatePickerInput
                id="ext-expiry"
                placeholder="YYYY-MM-DD"
                labelText="New expiry date"
                invalid={!!errors.expiry}
                invalidText={errors.expiry ?? ''}
                disabled={busy}
              />
            </DatePicker>
          )}
        </div>

        <hr className="ext-modal__divider" />

        <div className="ext-modal__section">
          <p className="ext-modal__section-title">Attachments</p>
          <DragDropFileInput
            multiple
            helperText={
              `Attach the signed extension request letter and any supporting `
              + `documents — up to ${MAX_FILES} files. `
              + `Accepted: ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}.`
            }
            accept={ACCEPTED_ATTACHMENT_EXTENSIONS}
            files={files}
            disabled={busy}
            onSelectMany={addFiles}
            onRemoveAt={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
          />
        </div>

        <TextArea
          id="ext-comment"
          labelText="Comments (optional)"
          placeholder="Add any context for the district reviewing this request."
          enableCounter
          maxCount={COMMENT_MAX}
          rows={4}
          value={comment}
          invalid={!!errors.comment}
          invalidText={errors.comment ?? ''}
          disabled={busy}
          onChange={(e) => setComment(e.target.value)}
        />

        <p className="ext-modal__note">
          After submitting, you won&apos;t be able to make changes to this
          request.
        </p>
      </div>

      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={busy} onClick={closeIfIdle}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={busy}
          renderIcon={busy ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {busy ? 'Submitting…' : 'Submit request'}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default ExtensionRequestModal;
