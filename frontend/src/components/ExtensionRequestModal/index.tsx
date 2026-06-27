import {
  Button,
  DatePicker,
  DatePickerInput,
  Loading,
  Modal,
  NumberInput,
  Stack,
  TextArea,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { createExtensionRequest, type FspInformation } from '@/services/fspSearch';

/**
 * Dialog for the FSP302 "New Extension Request" flow. Captures the
 * proposed new plan term (years/months) and / or new expiry date plus
 * a status comment. Posts to {@code POST /v1/fsp/{fspId}/extensions}
 * which routes through {@code FSP_302_EXTENSION_REQUEST.SAVE} →
 * {@code fsp_common_db.fsp_create_extension}.
 *
 * <p>The legacy form lets the user supply either the new term or the
 * new expiry date — the proc derives the other end. We surface both
 * inputs and let the proc accept whatever's populated.
 */
interface Props {
  open: boolean;
  fsp: FspInformation | null;
  onClose: () => void;
  /** Called after a successful create; receives the new extension id. */
  onCreated: (extensionId: string | null) => void;
}

const COMMENT_MAX = 2000;

const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const ExtensionRequestModal: FC<Props> = ({ open, fsp, onClose, onCreated }) => {
  const { display } = useNotification();
  const [busy, setBusy] = useState(false);
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{
    term?: string;
    expiry?: string;
    comment?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    setYears('');
    setMonths('');
    setExpiryDate('');
    setComment('');
    setErrors({});
  }, [open]);

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    const hasTerm = years.trim() !== '' || months.trim() !== '';
    if (!hasTerm && !expiryDate) {
      next.term = 'Enter a new term (years/months) or an expiry date.';
    }
    if (years && !/^\d+$/.test(years)) {
      next.term = 'Years must be a whole number ≥ 0.';
    }
    if (months && !/^\d+$/.test(months)) {
      next.term = 'Months must be a whole number ≥ 0.';
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
        planTermYears: years.trim() || null,
        planTermMonths: months.trim() || null,
        fspExpiryDate: expiryDate || null,
        statusComment: comment.trim() || null,
        revisionCount: fsp.revisionCount,
      });
      onCreated(result.extensionId);
      onClose();
      display({
        kind: 'success',
        title: 'Extension request submitted.',
        subtitle: result.extensionId
          ? `New extension #${result.extensionId}`
          : undefined,
        timeout: 6000,
      });
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
      modalHeading="New extension request"
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeIfIdle}
      preventCloseOnClickOutside
    >
      <Stack gap={5} className="fsp-species-modal__form">
        {/* Read-only context block (FSP302 "current" details): the
            legacy page surfaces the existing term + expiry alongside
            the editable "new" fields so the user can see what they're
            changing from. */}
        <dl className="ext-modal__context">
          <div className="ext-modal__context-row">
            <dt>Current FSP expiry date</dt>
            <dd>{fsp?.fspExpiryDate || fsp?.fspPlanEndDate || '—'}</dd>
          </div>
          <div className="ext-modal__context-row">
            <dt>Current term</dt>
            <dd>
              {(fsp?.fspPlanTermYears && `${fsp.fspPlanTermYears} yr`) || '0 yr'}{' '}
              {(fsp?.fspPlanTermMonths && `${fsp.fspPlanTermMonths} mo`) || '0 mo'}
            </dd>
          </div>
          <div className="ext-modal__context-row">
            <dt>FSP effective date</dt>
            <dd>{fsp?.fspPlanStartDate || '—'}</dd>
          </div>
        </dl>
        <p className="fsp-species-modal__hint">
          Enter the proposed new plan term <em>or</em> the new expiry date — the
          proc will calculate the other end.
        </p>
        {/* Years + Months side-by-side in a grid so each NumberInput
            occupies its own column with proper breathing room. The
            .ext-modal__term-grid class also resets Carbon's hard-coded
            `min-inline-size: 9.375rem` on `.cds--number input`, which
            would otherwise blow past the column width and smash them
            together horizontally. */}
        <div className="ext-modal__term-grid">
          <NumberInput
            id="ext-years"
            label="New term — years"
            min={0}
            max={99}
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
            label="New term — months"
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
        <TextArea
          id="ext-comment"
          labelText="Status comment"
          placeholder="Optional — describe why the extension is being requested."
          maxLength={COMMENT_MAX}
          rows={4}
          value={comment}
          invalid={!!errors.comment}
          invalidText={errors.comment ?? ''}
          disabled={busy}
          onChange={(e) => setComment(e.target.value)}
        />
      </Stack>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={busy} onClick={closeIfIdle}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={busy}
          renderIcon={busy ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {busy ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default ExtensionRequestModal;
