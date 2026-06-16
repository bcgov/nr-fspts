import {
  Button,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Loading,
  Modal,
  Stack,
  TextArea,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';

export type OtbhEventKey = 'offered' | 'heard';

export interface OtbhDialogValue {
  /** Which event the user is editing. Drives the SAVE_OTBH_OFFERED vs HEARD dispatch. */
  key: OtbhEventKey;
  /** Display label — "OTBH Offered" / "OTBH Heard". */
  label: string;
  /** Existing date if any. YYYY-MM-DD. */
  date: string | null;
  /** Existing comment if any. */
  comment: string | null;
}

interface OtbhEditModalProps {
  open: boolean;
  value: OtbhDialogValue | null;
  onClose: () => void;
  /**
   * Submit handler. Modal awaits and only closes on success — throw
   * to keep it open for retry. Receives the editable payload; key
   * comes from {@code value.key}.
   */
  onSubmit: (payload: { date: string; comment: string }) => Promise<void>;
}

const isoToday = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Single dialog for editing one OTBH event (Offered or Heard). The
 * legacy FSP700 page used a JS confirm() to warn the user that
 * saving Offered changes the FSP status to "Opportunity to be Heard";
 * we surface that warning as an inline banner inside the dialog so
 * the explicit Save click is the confirmation.
 *
 * <p>Date validation: the proc rejects future dates with FSP.BAD.OTBH.DATE.
 * We enforce it client-side first so the user gets immediate feedback.
 */
const OtbhEditModal: FC<OtbhEditModalProps> = ({
  open,
  value,
  onClose,
  onSubmit,
}) => {
  const { display } = useNotification();
  const [date, setDate] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset/prefill on every open. Default the date to today when the
  // row has no existing value so the user can click Save immediately
  // without having to pick a date for the typical "happening now" case.
  useEffect(() => {
    if (!open) return;
    setDate(value?.date ?? isoToday());
    setComment(value?.comment ?? '');
  }, [open, value]);

  if (!value) return null;

  const isOffered = value.key === 'offered';
  const dateInFuture = date > isoToday();
  const dateMissing = date.trim() === '';
  const canSubmit = !saving && !dateMissing && !dateInFuture;

  const closeDialog = () => {
    if (saving) return;
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({ date, comment: comment.trim() });
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: `Failed to save ${value.label}`,
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSaving(false);
    }
  };

  const bannerTitle = isOffered
    ? 'Saving will change the FSP status to Opportunity to be Heard.'
    : 'Saving will return the FSP status to Submitted.';

  return (
    <Modal
      open={open}
      modalHeading={`Edit ${value.label}`}
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form">
        {/* Stack with gap=6 (Carbon spacing-06, ~1.5rem) puts proper
            air between the info banner and the date input — Carbon's
            InlineNotification has no bottom margin of its own so the
            two used to butt up against each other. */}
        <Stack gap={6}>
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title={bannerTitle}
            // Suppress the default subtitle padding so the banner reads
            // as one tight line at the top of the form.
            subtitle=""
          />
          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            maxDate={isoToday()}
            value={date || undefined}
            onChange={(dates: Date[]) =>
              setDate(dates[0] ? toIsoDate(dates[0]) : '')
            }
          >
            <DatePickerInput
              id="otbh-date"
              placeholder="YYYY-MM-DD"
              labelText={`${value.label} Date *`}
              disabled={saving}
              invalid={dateInFuture}
              invalidText="OTBH date cannot be in the future."
            />
          </DatePicker>
          <TextArea
            id="otbh-comment"
            labelText="Comment"
            helperText="Optional — up to 4000 characters."
            maxLength={4000}
            rows={5}
            value={comment}
            disabled={saving}
            onChange={(e) => setComment(e.target.value)}
          />
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

export default OtbhEditModal;
