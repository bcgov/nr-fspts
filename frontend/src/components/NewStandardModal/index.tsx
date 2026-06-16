import {
  Button,
  DatePicker,
  DatePickerInput,
  Loading,
  Modal,
  NumberInput,
  Select,
  SelectItem,
  Stack,
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import {
  type CodeOption,
  createStandardRegime,
  getStatuteCodes,
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
const GEO_MAX = 50;
const ADDITIONAL_MAX = 2000;

// Same shape every other dialog uses to convert a flatpickr Date
// back to the YYYY-MM-DD string our DTOs expect.
const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// THE.STANDARDS_REGIME.SILV_STATUTE_CODE is VARCHAR2(3) and FKs to
// THE.SILV_STATUTE_CODE. We can't hard-code values here — different
// deployments seed different rows. The dropdown is populated from
// GET /v1/fsp/code-lists/statutes (FSP_CODE_LISTS.GET_STATUTE_CD)
// when the modal opens, matching the legacy code-list loader.

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
  const [regulation, setRegulation] = useState('');
  // Statute codes (Regulation dropdown) — loaded on first open of
  // the modal and cached for the lifetime of the component.
  const [statuteOptions, setStatuteOptions] = useState<CodeOption[]>([]);
  const [statutesLoading, setStatutesLoading] = useState(false);
  const [geographic, setGeographic] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [regenObligation, setRegenObligation] = useState(true);
  const [regenDelayYrs, setRegenDelayYrs] = useState('');
  const [fgEarlyYrs, setFgEarlyYrs] = useState('');
  const [fgLateYrs, setFgLateYrs] = useState('');
  const [additional, setAdditional] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    objective?: string;
    geographic?: string;
    additional?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setObjective('');
    setGeographic('');
    setExpiryDate('');
    setRegenObligation(true);
    setRegenDelayYrs('');
    setFgEarlyYrs('');
    setFgLateYrs('');
    setAdditional('');
    setErrors({});
  }, [open]);

  // One-shot statute-code load on first open. Default-selects the
  // first row so the dropdown isn't empty (the FK enforcement
  // guarantees every option in here is valid).
  useEffect(() => {
    if (!open || statuteOptions.length > 0 || statutesLoading) return;
    let cancelled = false;
    setStatutesLoading(true);
    getStatuteCodes()
      .then((rows) => {
        if (cancelled) return;
        setStatuteOptions(rows);
        if (rows.length > 0) setRegulation(rows[0].code);
      })
      .catch((e) => {
        if (!cancelled) {
          display({
            kind: 'error',
            title: 'Unable to load regulation codes',
            subtitle: e instanceof Error ? e.message : 'Unknown error',
            timeout: 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setStatutesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, statuteOptions.length, statutesLoading, display]);

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
    if (geographic.length > GEO_MAX) {
      next.geographic = `Max ${GEO_MAX} characters.`;
    }
    if (additional.length > ADDITIONAL_MAX) {
      next.additional = `Max ${ADDITIONAL_MAX} characters.`;
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
        regulationCode: regulation,
        geographicDescription: geographic.trim() || null,
        expiryDate: expiryDate || null,
        regenObligationInd: regenObligation ? 'Y' : 'N',
        regenDelayOffsetYrs: regenObligation ? regenDelayYrs.trim() || null : null,
        freeGrowingEarlyOffsetYrs:
          regenObligation ? fgEarlyYrs.trim() || null : null,
        freeGrowingLateOffsetYrs:
          regenObligation ? fgLateYrs.trim() || null : null,
        additionalStandards: additional.trim() || null,
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
        <TextInput
          id="new-std-name"
          labelText="Name *"
          maxLength={NAME_MAX}
          value={name}
          invalid={!!errors.name}
          invalidText={errors.name ?? ''}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <TextInput
          id="new-std-objective"
          labelText="Objective *"
          maxLength={OBJECTIVE_MAX}
          value={objective}
          invalid={!!errors.objective}
          invalidText={errors.objective ?? ''}
          disabled={busy}
          onChange={(e) => setObjective(e.target.value)}
        />
        <Select
          id="new-std-regulation"
          labelText={statutesLoading ? 'Regulation (loading…)' : 'Regulation'}
          value={regulation}
          disabled={busy || statutesLoading}
          onChange={(e) => setRegulation(e.target.value)}
        >
          {statuteOptions.map((opt) => (
            <SelectItem
              key={opt.code ?? ''}
              value={opt.code ?? ''}
              text={
                opt.description && opt.code
                  ? `${opt.code} — ${opt.description}`
                  : opt.code ?? opt.description ?? ''
              }
            />
          ))}
        </Select>
        <TextInput
          id="new-std-geographic"
          labelText="Geographic description"
          maxLength={GEO_MAX}
          value={geographic}
          invalid={!!errors.geographic}
          invalidText={errors.geographic ?? ''}
          disabled={busy}
          onChange={(e) => setGeographic(e.target.value)}
        />
        <Toggle
          id="new-std-regen"
          labelText="Regen obligation"
          labelA="No"
          labelB="Yes"
          toggled={regenObligation}
          disabled={busy}
          onToggle={setRegenObligation}
        />
        {regenObligation && (
          <div className="new-std-modal__offset-grid">
            <NumberInput
              id="new-std-regen-delay"
              label="Regen Delay (yrs)"
              min={0}
              max={99}
              allowEmpty
              hideSteppers
              value={regenDelayYrs === '' ? '' : Number(regenDelayYrs)}
              disabled={busy}
              onChange={(_e, { value }) =>
                setRegenDelayYrs(value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id="new-std-fg-early"
              label="Free Growing — Early (yrs)"
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
              label="Free Growing — Late (yrs) *"
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
        )}
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
            labelText="Expiry date"
            disabled={busy}
          />
        </DatePicker>
        <TextArea
          id="new-std-additional"
          labelText="Additional standards"
          helperText={`Optional — up to ${ADDITIONAL_MAX} characters.`}
          maxLength={ADDITIONAL_MAX}
          rows={4}
          value={additional}
          invalid={!!errors.additional}
          invalidText={errors.additional ?? ''}
          disabled={busy}
          onChange={(e) => setAdditional(e.target.value)}
        />
        <p className="fsp-info__placeholder" style={{ margin: 0 }}>
          Layers, species, and BGC zones can be added from the regime
          panel once it's created.
        </p>
      </Stack>
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
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default NewStandardModal;
