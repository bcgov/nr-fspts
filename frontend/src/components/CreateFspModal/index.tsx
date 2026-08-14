import {
  Button,
  ComboBox,
  DatePicker,
  DatePickerInput,
  Loading,
  RadioButton,
  RadioButtonGroup,
  Tag,
  TextInput,
} from '@carbon/react';
import { useEffect, useMemo, useState, type FC } from 'react';

import { Modal } from '@/components/Modal';
import { listSubmitterClientNumbers } from '@/context/auth/authUtils';
import { useAuth } from '@/context/auth/useAuth';
import { useOrg } from '@/context/org/useOrg';
import { safeErrorMessage } from '@/lib/errorMessage';
import {
  createFsp,
  getOrgUnits,
  type CodeOption,
} from '@/services/fspSearch';
import { searchClientsAuto, type ClientSearchResult } from '@/services/clientSearch';
import './CreateFspModal.scss';

/**
 * FSP300 "Create FSP" dialog — the manual counterpart of the XML/GeoJSON
 * Data Submission flow. Captures only what
 * {@code FSP_COMMON_VALIDATION} requires of a brand-new plan; everything
 * else is filled in afterwards on the FSP's own tabs.
 *
 * The proc assigns the FSP id, so the dialog can't show one until it
 * returns — on success the caller navigates into the new plan.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new FSP id after a successful create. */
  onCreated: (fspId: string) => void;
}

// Mirrors backend FspFieldRules, which reads them off the columns.
const MAX = {
  planName: 120,
  contactName: 120,
  emailAddress: 120,
} as const;

const PHONE_DIGITS = 10;
/** PLAN_TERM_YEARS / PLAN_TERM_MONTHS are NUMBER(3). */
const MAX_TERM_DIGITS = 3;

type TermMode = 'term' | 'endDate';

interface FormState {
  planName: string;
  contactName: string;
  telephoneNumber: string;
  emailAddress: string;
  planTermYears: string;
  planTermMonths: string;
  planEndDate: string;
}

const EMPTY: FormState = {
  planName: '',
  contactName: '',
  telephoneNumber: '',
  emailAddress: '',
  planTermYears: '',
  planTermMonths: '',
  planEndDate: '',
};

/** Strip everything but digits — the column holds 10 characters, so a
 *  pasted "(250) 720-6237" has to lose its formatting on the way in. */
const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const CreateFspModal: FC<Props> = ({ open, onClose, onCreated }) => {
  const { user } = useAuth();
  const { activeOrgClientNumber } = useOrg();

  /**
   * The submitter's own forest client, mirroring how the backend resolves it
   * (RequestUtil.getCurrentClientNumber): the active org when one is chosen,
   * otherwise their single submitter client. Null for IDIR/admin users, who
   * hold no client-tied role.
   *
   * <p>This org MUST be an agreement holder on a plan they create — the proc
   * raises FSP.INVALID.AGREEMENT.HOLDER otherwise — so it's added
   * automatically and cannot be removed. A multi-org submitter with no active
   * selection can't reach this screen (OrgProvider gates on that), so the
   * single-element case is the only ambiguity worth resolving here.
   */
  const ownClientNumber = useMemo(() => {
    if (activeOrgClientNumber) return activeOrgClientNumber;
    const own = listSubmitterClientNumbers(user?.privileges ?? {});
    return own.length === 1 ? own[0] : null;
  }, [activeOrgClientNumber, user]);

  // Resolved name for the pinned holder; falls back to the bare number.
  const [ownClientName, setOwnClientName] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [termMode, setTermMode] = useState<TermMode>('term');
  const [holders, setHolders] = useState<ClientSearchResult[]>([]);
  const [districts, setDistricts] = useState<CodeOption[]>([]);
  const [districtOptions, setDistrictOptions] = useState<CodeOption[]>([]);
  const [clientResults, setClientResults] = useState<ClientSearchResult[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [listErrors, setListErrors] = useState<{ holders?: string; districts?: string }>({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset every time the dialog opens so a cancelled attempt doesn't
  // leak into the next one.
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setTermMode('term');
    setHolders([]);
    setDistricts([]);
    setClientResults([]);
    setErrors({});
    setListErrors({});
    setSubmitError('');
  }, [open]);

  useEffect(() => {
    if (!open || !ownClientNumber) {
      setOwnClientName(null);
      return;
    }
    let cancelled = false;
    searchClientsAuto(ownClientNumber)
      .then((results) => {
        if (cancelled) return;
        const match = results.find((r) => r.clientNumber === ownClientNumber);
        setOwnClientName(match?.clientName ?? null);
      })
      // A failed lookup is cosmetic — the chip still shows the number, which
      // is the part the payload carries.
      .catch(() => {
        if (!cancelled) setOwnClientName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ownClientNumber]);

  useEffect(() => {
    if (!open || districtOptions.length > 0) return;
    // Same source as the FSP details "Add district" picker
    // (DistrictPickerModal): FSP_CODE_LISTS.get_org_unit_filtered, whose rows
    // are code = org_unit_no (numeric) and description = "DCK - Chilliwack".
    // The org-unit-CODES list is a different lookup keyed by the 3-letter
    // code, and the proc can't use those.
    getOrgUnits()
      .then(setDistrictOptions)
      .catch(() => setDistrictOptions([]));
  }, [open, districtOptions.length]);

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSubmitError('');
  };

  const availableDistricts = useMemo(
    () => districtOptions.filter((o) => !districts.some((d) => d.code === o.code)),
    [districtOptions, districts],
  );

  const runClientSearch = (term: string) => {
    if (term.trim().length < 3) {
      setClientResults([]);
      return;
    }
    setClientSearching(true);
    searchClientsAuto(term)
      .then((res) => setClientResults(res))
      .catch(() => setClientResults([]))
      .finally(() => setClientSearching(false));
  };

  const addHolder = (client: ClientSearchResult | null) => {
    if (!client?.clientNumber) return;
    // Already pinned below — adding it again would send a duplicate.
    if (client.clientNumber === ownClientNumber) return;
    setHolders((prev) =>
      prev.some((h) => h.clientNumber === client.clientNumber) ? prev : [...prev, client],
    );
    setListErrors((prev) => ({ ...prev, holders: undefined }));
    setSubmitError('');
  };

  const addDistrict = (district: CodeOption | null) => {
    if (!district) return;
    setDistricts((prev) =>
      prev.some((d) => d.code === district.code) ? prev : [...prev, district],
    );
    setListErrors((prev) => ({ ...prev, districts: undefined }));
    setSubmitError('');
  };

  /** Mirrors the server rules so the common mistakes never cost a round trip. */
  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    const lists: { holders?: string; districts?: string } = {};

    if (!form.planName.trim()) next.planName = 'Plan name is required.';
    else if (form.planName.trim().length > MAX.planName) {
      next.planName = `Maximum ${MAX.planName} characters.`;
    }

    if (!form.contactName.trim()) next.contactName = 'Contact name is required.';
    else if (form.contactName.trim().length > MAX.contactName) {
      next.contactName = `Maximum ${MAX.contactName} characters.`;
    }

    if (!form.telephoneNumber.trim()) {
      next.telephoneNumber = 'Telephone is required.';
    } else if (!/^\d{10}$/.test(form.telephoneNumber.trim())) {
      next.telephoneNumber = `Must be exactly ${PHONE_DIGITS} digits.`;
    }

    if (!form.emailAddress.trim()) next.emailAddress = 'Email is required.';
    else if (form.emailAddress.trim().length > MAX.emailAddress) {
      next.emailAddress = `Maximum ${MAX.emailAddress} characters.`;
    }

    if (holders.length === 0 && !ownClientNumber) {
      lists.holders = 'Add at least one agreement holder.';
    }
    if (districts.length === 0) lists.districts = 'Add at least one district.';

    if (termMode === 'term') {
      const hasTerm = form.planTermYears.trim() || form.planTermMonths.trim();
      if (!hasTerm) next.planTermYears = 'Enter a plan term.';
      else if (
        (form.planTermYears.trim() && !/^\d{1,3}$/.test(form.planTermYears.trim()))
        || (form.planTermMonths.trim() && !/^\d{1,3}$/.test(form.planTermMonths.trim()))
      ) {
        next.planTermYears = `Whole numbers, up to ${MAX_TERM_DIGITS} digits.`;
      }
    } else if (!form.planEndDate.trim()) {
      next.planEndDate = 'Enter a plan end date.';
    }

    setErrors(next);
    setListErrors(lists);
    return Object.keys(next).length === 0 && Object.keys(lists).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    setSubmitError('');
    try {
      const created = await createFsp({
        planName: form.planName.trim(),
        contactName: form.contactName.trim(),
        telephoneNumber: form.telephoneNumber.trim(),
        emailAddress: form.emailAddress.trim(),
        agreementHolderClientNumbers: [
          ...(ownClientNumber ? [ownClientNumber] : []),
          ...holders.map((h) => h.clientNumber ?? '').filter(Boolean),
        ],
        districtOrgUnitNos: districts.map((d) => d.code),
        // Only ever send one side of the term/end-date pair — the proc
        // rejects a payload carrying both.
        planTermYears: termMode === 'term' ? form.planTermYears.trim() : null,
        planTermMonths: termMode === 'term' ? form.planTermMonths.trim() : null,
        planEndDate: termMode === 'endDate' ? form.planEndDate.trim() : null,
      });
      onCreated(created.fspId);
    } catch (e) {
      setSubmitError(
        safeErrorMessage(
          e instanceof Error ? e.message : '',
          'The FSP could not be created. Please try again.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onRequestClose={saving ? undefined : onClose}
      modalHeading="Create Forest Stewardship Plan"
      // passiveModal + our own action row: Carbon's built-in footer renders
      // the buttons as a full-width 50/50 pair, which every other dialog in
      // this app opts out of. Same shape as BgcZoneEditModal / NewStandardModal.
      passiveModal
      className="fsp-species-modal"
      size="md"
      preventCloseOnClickOutside
    >
      <p className="create-fsp__intro">
        Enter the details needed to open a draft plan. You can add stocking
        standards, FDUs and attachments once the plan exists.
      </p>

      {submitError && (
        <div className="create-fsp__error" role="alert">
          {submitError}
        </div>
      )}

      <div className="create-fsp__grid">
        <div className="create-fsp__cell create-fsp__cell--full">
          <TextInput
            id="create-fsp-plan-name"
            labelText="Plan name"
            value={form.planName}
            maxLength={MAX.planName}
            invalid={!!errors.planName}
            invalidText={errors.planName}
            disabled={saving}
            onChange={(e) => setField('planName', e.target.value)}
          />
        </div>

        <div className="create-fsp__cell">
          <TextInput
            id="create-fsp-contact-name"
            labelText="Contact name"
            value={form.contactName}
            maxLength={MAX.contactName}
            invalid={!!errors.contactName}
            invalidText={errors.contactName}
            disabled={saving}
            onChange={(e) => setField('contactName', e.target.value)}
          />
        </div>

        <div className="create-fsp__cell">
          <TextInput
            id="create-fsp-telephone"
            labelText="Telephone"
            placeholder="2507206237"
            helperText="10 digits, no spaces or dashes"
            value={form.telephoneNumber}
            maxLength={PHONE_DIGITS}
            invalid={!!errors.telephoneNumber}
            invalidText={errors.telephoneNumber}
            disabled={saving}
            onChange={(e) => setField('telephoneNumber', digitsOnly(e.target.value))}
          />
        </div>

        <div className="create-fsp__cell create-fsp__cell--full">
          <TextInput
            id="create-fsp-email"
            labelText="Contact email"
            type="email"
            value={form.emailAddress}
            maxLength={MAX.emailAddress}
            invalid={!!errors.emailAddress}
            invalidText={errors.emailAddress}
            disabled={saving}
            onChange={(e) => setField('emailAddress', e.target.value)}
          />
        </div>

        <div className="create-fsp__cell create-fsp__cell--full">
          <ComboBox
            id="create-fsp-holder"
            titleText="Agreement holders"
            helperText={
              ownClientNumber
                ? 'Your organization is included automatically. Search to add others.'
                : 'Search by client number or name, then pick to add'
            }
            placeholder="Type at least 3 characters"
            items={clientResults}
            itemToString={(i: ClientSearchResult | null) =>
              i ? `${i.clientNumber} — ${i.clientName ?? ''}`.trim() : ''}
            onInputChange={runClientSearch}
            onChange={({ selectedItem }) => addHolder(selectedItem ?? null)}
            selectedItem={null}
            invalid={!!listErrors.holders}
            invalidText={listErrors.holders}
            disabled={saving}
          />
          {clientSearching && <Loading small withOverlay={false} description="Searching" />}
          {(ownClientNumber || holders.length > 0) && (
            <div className="create-fsp__chips">
              {ownClientNumber && (
                // Not a `filter` Tag: this org is the caller's own and the
                // proc rejects a plan whose holders don't include it
                // (FSP.INVALID.AGREEMENT.HOLDER), so there is no valid state
                // in which removing it helps.
                <Tag type="blue" className="create-fsp__chip--pinned">
                  {ownClientName
                    ? `${ownClientNumber} — ${ownClientName}`
                    : ownClientNumber}
                  <span className="create-fsp__chip-required">Your organization</span>
                </Tag>
              )}
              {holders.map((h) => (
                <Tag
                  key={h.clientNumber ?? ''}
                  type="blue"
                  filter
                  disabled={saving}
                  onClose={() =>
                    setHolders((prev) =>
                      prev.filter((x) => x.clientNumber !== h.clientNumber))}
                >
                  {`${h.clientNumber} — ${h.clientName ?? ''}`.trim()}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <div className="create-fsp__cell create-fsp__cell--full">
          <ComboBox
            id="create-fsp-district"
            titleText="Districts"
            helperText="Pick each district the plan covers"
            placeholder="Search districts"
            items={availableDistricts}
            itemToString={(i: CodeOption | null) => (i ? i.description : '')}
            onChange={({ selectedItem }) => addDistrict(selectedItem ?? null)}
            selectedItem={null}
            invalid={!!listErrors.districts}
            invalidText={listErrors.districts}
            disabled={saving}
          />
          {districts.length > 0 && (
            <div className="create-fsp__chips">
              {districts.map((d) => (
                <Tag
                  key={d.code}
                  type="green"
                  filter
                  disabled={saving}
                  onClose={() =>
                    setDistricts((prev) => prev.filter((x) => x.code !== d.code))}
                >
                  {d.description}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <div className="create-fsp__cell create-fsp__cell--full">
          <RadioButtonGroup
            legendText="Plan duration"
            name="create-fsp-term-mode"
            valueSelected={termMode}
            onChange={(value) => {
              setTermMode(value as TermMode);
              setErrors({});
            }}
            disabled={saving}
          >
            <RadioButton labelText="Set a term" value="term" id="create-fsp-mode-term" />
            <RadioButton
              labelText="Set an end date"
              value="endDate"
              id="create-fsp-mode-end"
            />
          </RadioButtonGroup>
          <p className="create-fsp__hint">
            A plan carries a term or an end date — not both.
          </p>
        </div>

        {termMode === 'term' ? (
          <>
            <div className="create-fsp__cell">
              <TextInput
                id="create-fsp-term-years"
                labelText="Term (years)"
                value={form.planTermYears}
                maxLength={MAX_TERM_DIGITS}
                invalid={!!errors.planTermYears}
                invalidText={errors.planTermYears}
                disabled={saving}
                onChange={(e) => setField('planTermYears', digitsOnly(e.target.value))}
              />
            </div>
            <div className="create-fsp__cell">
              <TextInput
                id="create-fsp-term-months"
                labelText="Term (months)"
                value={form.planTermMonths}
                maxLength={MAX_TERM_DIGITS}
                disabled={saving}
                onChange={(e) => setField('planTermMonths', digitsOnly(e.target.value))}
              />
            </div>
          </>
        ) : (
          <div className="create-fsp__cell">
            <DatePicker
              datePickerType="single"
              dateFormat="Y-m-d"
              value={form.planEndDate}
              onChange={(dates: Date[]) => {
                const d = dates?.[0];
                setField(
                  'planEndDate',
                  d
                    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                      d.getDate(),
                    ).padStart(2, '0')}`
                    : '',
                );
              }}
            >
              <DatePickerInput
                id="create-fsp-end-date"
                labelText="Plan end date"
                placeholder="yyyy-mm-dd"
                pattern="\d{4}-\d{2}-\d{2}"
                invalid={!!errors.planEndDate}
                invalidText={errors.planEndDate}
                disabled={saving}
              />
            </DatePicker>
          </div>
        )}
      </div>

      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={saving}
          onClick={() => void handleSubmit()}
        >
          {saving ? 'Creating…' : 'Create FSP'}
        </Button>
      </div>
    </Modal>
  );
};

export default CreateFspModal;
export { CreateFspModal };
