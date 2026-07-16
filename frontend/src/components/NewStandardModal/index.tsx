import {
  Button,
  DatePicker,
  DatePickerInput,
  Loading,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
  Stack,
  TextArea,
  TextInput,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { Information } from '@carbon/icons-react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import {
  createStandardRegime,
  type StandardRegimeCreate,
  type StandardRegimeDetail,
} from '@/services/fspSearch';

interface Props {
  open: boolean;
  fspId: string;
  amendmentNumber: string;
  onClose: () => void;
  /** Called after a successful create with the freshly-assigned regime. */
  onCreated: (regime: StandardRegimeDetail) => void;
}

const NAME_MAX = 50;
const OBJECTIVE_MAX = 50;
const COMMENT_MAX = 2000;

// Same shape every other dialog uses to convert a flatpickr Date
// back to the YYYY-MM-DD string our DTOs expect.
const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * FSP550 "Create Standard" dialog — captures the regime's tombstone +
 * regen-obligations sections, then routes to {@code POST
 * /v1/fsp/{fspId}/standards} → {@code FSP_550_STDS_PROPOSAL.SAVE}
 * (insert branch). On success the parent re-fetches the standards
 * list and selects the new regime in the detail panel so the user
 * can immediately add layers, species, and BGC zones.
 */
const NewStandardModal: FC<Props> = ({
  open,
  fspId,
  amendmentNumber,
  onClose,
  onCreated,
}) => {
  const { display } = useNotification();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [regenObligation, setRegenObligation] = useState(true);
  const [regenDelayYrs, setRegenDelayYrs] = useState('');
  const [fgEarlyYrs, setFgEarlyYrs] = useState('');
  const [fgLateYrs, setFgLateYrs] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    objective?: string;
    comment?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setObjective('');
    setExpiryDate('');
    setRegenObligation(true);
    setRegenDelayYrs('');
    setFgEarlyYrs('');
    setFgLateYrs('');
    setComment('');
    setErrors({});
  }, [open]);

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Name is required.';
    else if (name.length > NAME_MAX) next.name = `Max ${NAME_MAX} characters.`;
    if (!objective.trim()) next.objective = 'Objective is required.';
    else if (objective.length > OBJECTIVE_MAX) {
      next.objective = `Max ${OBJECTIVE_MAX} characters.`;
    }
    if (comment.length > COMMENT_MAX) {
      next.comment = `Max ${COMMENT_MAX} characters.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const payload: StandardRegimeCreate = {
        fspAmendmentNumber: amendmentNumber,
        standardsRegimeName: name.trim(),
        standardsObjective: objective.trim(),
        expiryDate: expiryDate || null,
        regenObligationInd: regenObligation ? 'Y' : 'N',
        // On "Yes" the three offsets are Regen delay / Free growing early /
        // late. On "No" the Regen delay drops out and Early / Late route
        // to the no-regen columns (mirrors the Overview edit pane).
        regenDelayOffsetYrs: regenObligation ? regenDelayYrs.trim() || null : null,
        freeGrowingEarlyOffsetYrs:
          regenObligation ? fgEarlyYrs.trim() || null : null,
        freeGrowingLateOffsetYrs:
          regenObligation ? fgLateYrs.trim() || null : null,
        noRegenEarlyOffsetYrs: regenObligation ? null : fgEarlyYrs.trim() || null,
        noRegenLateOffsetYrs: regenObligation ? null : fgLateYrs.trim() || null,
        additionalStandards: comment.trim() || null,
      };
      const created = await createStandardRegime(fspId, payload);
      onCreated(created);
      onClose();
      display({
        kind: 'success',
        title: 'Standards regime created.',
        subtitle: created.standardsRegimeId
          ? `Standards ID: ${created.standardsRegimeId}`
          : undefined,
        timeout: 6000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to create standards regime',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 0,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      modalHeading="Create stocking standard"
      passiveModal
      size="md"
      onRequestClose={closeIfIdle}
      preventCloseOnClickOutside
      className="new-std-modal"
    >
      <Stack gap={5} className="new-std-modal__form">
        <p className="new-std-modal__intro">
          Standards ID, effective date and Draft status are assigned
          automatically on creation. All fields are required unless marked
          optional.
        </p>
        <TextInput
          id="new-std-name"
          labelText="Name"
          maxLength={NAME_MAX}
          value={name}
          invalid={!!errors.name}
          invalidText={errors.name ?? ''}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <TextInput
          id="new-std-objective"
          labelText="Objective"
          maxLength={OBJECTIVE_MAX}
          value={objective}
          invalid={!!errors.objective}
          invalidText={errors.objective ?? ''}
          disabled={busy}
          onChange={(e) => setObjective(e.target.value)}
        />
        <DatePicker
          datePickerType="single"
          dateFormat="Y-m-d"
          value={expiryDate || undefined}
          onChange={(dates: Date[]) =>
            setExpiryDate(dates[0] ? toIsoDate(dates[0]) : '')
          }
        >
          <DatePickerInput
            id="new-std-expiry"
            placeholder="YYYY-MM-DD"
            labelText="Expiry date (optional)"
            disabled={busy}
          />
        </DatePicker>
        <RadioButtonGroup
          name="new-std-regen"
          legendText="Regen obligation"
          valueSelected={regenObligation ? 'Y' : 'N'}
          disabled={busy}
          onChange={(v) => setRegenObligation(v === 'Y')}
        >
          <RadioButton id="new-std-regen-yes" labelText="Yes" value="Y" />
          <RadioButton id="new-std-regen-no" labelText="No" value="N" />
        </RadioButtonGroup>
        <div>
          <div className="new-std-modal__offset-grid">
            <NumberInput
              id="new-std-regen-delay"
              label="Regen delay (years)"
              min={0}
              max={99}
              allowEmpty
              hideSteppers
              value={regenDelayYrs === '' ? '' : Number(regenDelayYrs)}
              disabled={busy || !regenObligation}
              onChange={(_e, { value }) =>
                setRegenDelayYrs(value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id="new-std-fg-early"
              label="Free growing early (years)"
              min={0}
              max={99}
              allowEmpty
              hideSteppers
              value={fgEarlyYrs === '' ? '' : Number(fgEarlyYrs)}
              disabled={busy}
              onChange={(_e, { value }) =>
                setFgEarlyYrs(value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id="new-std-fg-late"
              label="Free growing late (years)"
              min={0}
              max={99}
              allowEmpty
              hideSteppers
              value={fgLateYrs === '' ? '' : Number(fgLateYrs)}
              disabled={busy}
              onChange={(_e, { value }) =>
                setFgLateYrs(value === '' ? '' : String(value))
              }
            />
          </div>
          <p className="new-std-modal__field-help">
            Max 20 years from commencement date (FRPA s.29). Fields adjust
            when &quot;No&quot; is selected.
          </p>
        </div>
        <TextArea
          id="new-std-comment"
          labelText="Comment (optional)"
          enableCounter
          maxCount={COMMENT_MAX}
          maxLength={COMMENT_MAX}
          rows={4}
          value={comment}
          invalid={!!errors.comment}
          invalidText={errors.comment ?? ''}
          disabled={busy}
          onChange={(e) => setComment(e.target.value)}
        />
      </Stack>
      <div className="new-std-modal__banner" role="note">
        <Information className="new-std-modal__banner-icon" size={20} />
        <span>
          Next step: layers, species and BGC zones are added in the regime
          panel after creation.
        </span>
      </div>
      <div className="new-std-modal__actions">
        <Button kind="secondary" disabled={busy} onClick={closeIfIdle}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={busy}
          renderIcon={busy ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {busy ? 'Creating…' : 'Create stocking standard'}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default NewStandardModal;
