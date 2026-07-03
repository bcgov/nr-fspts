import {
  Button,
  DataTable,
  DatePicker,
  DatePickerInput,
  NumberInput,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react';
import {Add, Edit, TrashCan} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

import AmendmentDescriptionModal from '@/components/AmendmentDescriptionModal';
import ClientSearchModal from '@/components/ClientSearchModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import DistrictPickerModal from '@/components/DistrictPickerModal';
import ExtensionSummaryModal from '@/components/ExtensionSummaryModal';
import {useAuth} from '@/context/auth/useAuth';
import {useNotification} from '@/context/notification/useNotification';
import {canEditFsp} from '@/routes/access';
import type {ClientSearchResult} from '@/services/clientSearch';
import {
  type CodeOption,
  type FspAgreementHolder,
  type FspDistrict,
  type FspInformation,
  updateFsp,
} from '@/services/fspSearch';

interface Props {
  fsp: FspInformation | null;
  onSaved: (updated: FspInformation) => void;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const yesNo = (value: string | null | undefined): string => {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return 'No';
  return '—';
};

// "5 years, 0 months" — only renders an em-dash when both halves are
// blank so partial entry (e.g. years filled, months still empty) still
// shows something useful.
const formatTerm = (
  years: string | null | undefined,
  months: string | null | undefined,
): string => {
  const y = (years ?? '').trim();
  const m = (months ?? '').trim();
  if (!y && !m) return '—';
  return `${y || '0'} years, ${m || '0'} months`;
};

interface FieldEntry {
  label: string;
  value: string;
}

const Field: FC<FieldEntry> = ({ label, value }) => (
  <div className="fsp-info__field">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

// ─── Edit-mode form state ──────────────────────────────────────────────

/**
 * Editable subset of FspInformation. Only fields the FSP-300 SAVE proc
 * accepts as user input. Status, IDs, audit columns, revision count,
 * and the proc-derived description fields are excluded — those come
 * back on the response and the parent refreshes from there.
 *
 * Toggles bind to a boolean here for Carbon's <Toggle>; we convert to
 * the proc's 'Y'/'N' strings just before the save call.
 */
interface EditFormState {
  fspPlanName: string;
  fspContactName: string;
  fspTelephoneNumber: string;
  fspEmailAddress: string;
  fspPlanStartDate: string;
  fspPlanEndDate: string;
  fspExpiryDate: string;
  fspPlanTermYears: string;
  fspPlanTermMonths: string;
  amendmentName: string;
  amendmentAuthority: string;
  amendmentReason: string;
  transitionInd: boolean;
  frpa197electionInd: boolean;
}

const createFormState = (fsp: FspInformation): EditFormState => ({
  fspPlanName: fsp.fspPlanName ?? '',
  fspContactName: fsp.fspContactName ?? '',
  fspTelephoneNumber: fsp.fspTelephoneNumber ?? '',
  fspEmailAddress: fsp.fspEmailAddress ?? '',
  fspPlanStartDate: fsp.fspPlanStartDate ?? '',
  fspPlanEndDate: fsp.fspPlanEndDate ?? '',
  fspExpiryDate: fsp.fspExpiryDate ?? '',
  fspPlanTermYears: fsp.fspPlanTermYears ?? '',
  fspPlanTermMonths: fsp.fspPlanTermMonths ?? '',
  amendmentName: fsp.amendmentName ?? '',
  amendmentAuthority: fsp.amendmentAuthority ?? '',
  amendmentReason: '', // not on read DTO; proc accepts it on save
  transitionInd: fsp.transitionInd === 'Y',
  frpa197electionInd: fsp.frpa197electionInd === 'Y',
});

/** Server-side column lengths from FSP_300_INFORMATION schema. */
const MAX = {
  fspPlanName: 120,
  fspContactName: 60,
  fspTelephoneNumber: 10,
  fspEmailAddress: 100,
  amendmentName: 30,
  amendmentAuthority: 50,
  amendmentReason: 2000,
} as const;

type Errors = Partial<Record<keyof EditFormState, string>>;

const validate = (form: EditFormState): Errors => {
  const errs: Errors = {};
  if (!form.fspPlanName.trim()) {
    errs.fspPlanName = 'Plan name is required.';
  } else if (form.fspPlanName.length > MAX.fspPlanName) {
    errs.fspPlanName = `Max ${MAX.fspPlanName} characters.`;
  }
  if (form.fspContactName.length > MAX.fspContactName) {
    errs.fspContactName = `Max ${MAX.fspContactName} characters.`;
  }
  if (form.fspTelephoneNumber && !/^\d{10}$/.test(form.fspTelephoneNumber)) {
    errs.fspTelephoneNumber = 'Must be exactly 10 digits.';
  }
  if (
    form.fspEmailAddress &&
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.fspEmailAddress)
  ) {
    errs.fspEmailAddress = 'Enter a valid email address.';
  }
  if (form.fspEmailAddress.length > MAX.fspEmailAddress) {
    errs.fspEmailAddress = `Max ${MAX.fspEmailAddress} characters.`;
  }
  if (form.amendmentName.length > MAX.amendmentName) {
    errs.amendmentName = `Max ${MAX.amendmentName} characters.`;
  }
  if (form.amendmentAuthority.length > MAX.amendmentAuthority) {
    errs.amendmentAuthority = `Max ${MAX.amendmentAuthority} characters.`;
  }
  if (form.amendmentReason.length > MAX.amendmentReason) {
    errs.amendmentReason = `Max ${MAX.amendmentReason} characters.`;
  }
  const years = form.fspPlanTermYears.trim();
  if (years && (!/^\d+$/.test(years) || Number(years) > 99)) {
    errs.fspPlanTermYears = 'Whole number 0–99.';
  }
  const months = form.fspPlanTermMonths.trim();
  if (months && (!/^\d+$/.test(months) || Number(months) > 11)) {
    errs.fspPlanTermMonths = 'Whole number 0–11.';
  }
  return errs;
};

/** Convert form state to the JSON payload the PUT endpoint accepts. */
const toPayload = (form: EditFormState): Partial<FspInformation> => ({
  fspPlanName: form.fspPlanName.trim(),
  fspContactName: form.fspContactName.trim() || null,
  fspTelephoneNumber: form.fspTelephoneNumber.trim() || null,
  fspEmailAddress: form.fspEmailAddress.trim() || null,
  fspPlanStartDate: form.fspPlanStartDate || null,
  fspPlanEndDate: form.fspPlanEndDate || null,
  fspExpiryDate: form.fspExpiryDate || null,
  fspPlanTermYears: form.fspPlanTermYears.trim() || null,
  fspPlanTermMonths: form.fspPlanTermMonths.trim() || null,
  amendmentName: form.amendmentName.trim() || null,
  amendmentAuthority: form.amendmentAuthority.trim() || null,
  amendmentReason: form.amendmentReason.trim() || null,
  transitionInd: form.transitionInd ? 'Y' : 'N',
  frpa197electionInd: form.frpa197electionInd ? 'Y' : 'N',
});

// ─── Component ─────────────────────────────────────────────────────────

const InformationTab: FC<Props> = ({ fsp, onSaved }) => {
  const { display } = useNotification();
  const { user } = useAuth();
  // Master edit gate — View-Only never edits; Submitter-only is locked
  // out while the FSP is in SUB (submitted-for-review). Other roles
  // get the existing behaviour. Drives the Edit button visibility and
  // the Agreement Holder / District add + remove affordances below.
  const canEdit = canEditFsp(user, fsp?.fspStatusCode);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(
    fsp ? createFormState(fsp) : null,
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  // Add-collection dialog state. Each one opens via its own button
  // on the Agreement Holders / Districts section headers; persistence
  // calls updateFsp with the full merged list so the proc rewrites
  // the licensees / org-units relations.
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [districtPickerOpen, setDistrictPickerOpen] = useState(false);

  // FSP301 dialog — covers both AMD ("Amendment Description") and RPL
  // ("Replacement Description") flows. Stored as a string so the same
  // modal instance can render the right heading text.
  const [amendmentDialog, setAmendmentDialog] = useState<
    'Amendment Description' | 'Replacement Description' | null
  >(null);
  const [extensionSummaryOpen, setExtensionSummaryOpen] = useState(false);
  // Holds the district pending removal so ConfirmationModal can render
  // the right label and the confirm handler knows which orgUnitNo to
  // drop from the PUT payload. Mirrors the BGC zone delete pattern in
  // StandardRegimeDetailPanel.
  const [districtDeleteTarget, setDistrictDeleteTarget] =
    useState<FspDistrict | null>(null);

  // Reset form whenever the underlying fsp changes (amendment switch,
  // post-save refresh, etc.) — same useEffect-guard idiom nr-rept uses.
  useEffect(() => {
    if (!editing && fsp) {
      setForm(createFormState(fsp));
      setErrors({});
    }
  }, [fsp, editing]);

  if (!fsp || !form) return null;

  const setField = <K extends keyof EditFormState>(key: K, value: EditFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleEdit = () => {
    setForm(createFormState(fsp));
    setErrors({});
    setEditing(true);
  };

  const handleCancel = () => {
    setForm(createFormState(fsp));
    setErrors({});
    setEditing(false);
  };

  const handleSave = async () => {
    const found = validate(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    if (!fsp.fspId) {
      display({
        kind: 'error',
        title: 'Cannot save',
        subtitle: 'FSP id missing — try reloading the page.',
        timeout: 7000,
      });
      return;
    }
    setSaving(true);
    try {
      const updated = await updateFsp(fsp.fspId, toPayload(form));
      onSaved(updated);
      setEditing(false);
      display({
        kind: 'success',
        title: 'FSP information updated.',
        timeout: 7000,
      });
    } catch (err) {
      display({
        kind: 'error',
        title: 'Failed to save FSP',
        subtitle: err instanceof Error ? err.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSaving(false);
    }
  };

  // Add a row to a collection (holders or districts) and PUT the
  // merged FSP. Persistence-side, FspService.applyEdits overlays the
  // supplied list onto the GET-resolved record before SAVE.
  const handleAddHolder = async (client: ClientSearchResult) => {
    if (!fsp?.fspId || !client.clientNumber) return;
    const next: FspAgreementHolder = {
      clientNumber: client.clientNumber,
      // Proc resolves clientName + agreement description server-side
      // on the next GET; sending null keeps the payload thin.
      clientName: client.clientName,
      agreementDescription: null,
    };
    const merged = [...(fsp.agreementHolders ?? []), next];
    const updated = await updateFsp(fsp.fspId, { agreementHolders: merged });
    onSaved(updated);
    display({
      kind: 'success',
      title: 'Agreement holder added.',
      subtitle: client.clientName || client.clientNumber || undefined,
      timeout: 6000,
    });
  };

  const handleAddDistrict = async (district: CodeOption) => {
    if (!fsp?.fspId || !district.code) return;
    // Belt-and-suspenders dedup. The modal already filters the
    // dropdown by org_unit_no, but if a race / refresh ever lets a
    // duplicate through we still want a friendly toast rather than a
    // silent second row in the list.
    const alreadyOn = (fsp.districts ?? []).some(
      (d) => d.orgUnitNo === district.code,
    );
    if (alreadyOn) {
      display({
        kind: 'warning',
        title: 'District is already included in this FSP',
        subtitle: district.description ?? district.code,
        timeout: 6000,
      });
      return;
    }
    // FSP_CODE_LISTS.get_org_unit_filtered returns rows shaped as
    //   code        = org_unit_no   (numeric, e.g. "15")
    //   description = "ORG_UNIT_CODE - ORG_UNIT_NAME" ("DCK - Chilliwack…")
    // Split that apart so the new row matches the shape the proc + the
    // existing FSP rows use (orgUnitNo numeric, orgUnitCode 3-letter,
    // orgUnitName plain).
    const desc = district.description ?? '';
    const dashIdx = desc.indexOf(' - ');
    const code = dashIdx > 0 ? desc.slice(0, dashIdx).trim() : null;
    const name = dashIdx > 0 ? desc.slice(dashIdx + 3).trim() : desc.trim() || null;
    const next: FspDistrict = {
      orgUnitNo: district.code,
      orgUnitCode: code,
      orgUnitName: name,
    };
    const merged = [...(fsp.districts ?? []), next];
    const updated = await updateFsp(fsp.fspId, { districts: merged });
    onSaved(updated);
    display({
      kind: 'success',
      title: 'District added.',
      subtitle: code ?? district.code,
      timeout: 6000,
    });
  };

  // Invoked by the ConfirmationModal's Confirm button. Re-fetches the
  // current districts list (snapshotting it from the close-over `fsp`
  // is fine because the ConfirmationModal blocks input while saving)
  // and PUTs the list minus the dropped row.
  const handleDeleteDistrictConfirmed = async () => {
    if (!fsp?.fspId || !districtDeleteTarget?.orgUnitNo) return;
    const merged = (fsp.districts ?? []).filter(
      (d) => d.orgUnitNo !== districtDeleteTarget.orgUnitNo,
    );
    const updated = await updateFsp(fsp.fspId, { districts: merged });
    onSaved(updated);
    display({
      kind: 'success',
      title: 'District removed.',
      subtitle:
        districtDeleteTarget.orgUnitCode ?? districtDeleteTarget.orgUnitNo,
      timeout: 6000,
    });
  };

  // ─── Read-only field lists ──────────────────────────────────────────

  const planDetails: FieldEntry[] = [
    { label: 'FSP name', value: dash(fsp.fspPlanName) },
    { label: 'Status', value: dash(fsp.fspStatusDesc) },
    { label: 'Amendment name', value: dash(fsp.amendmentName) },
    { label: 'Amendment type', value: dash(fsp.fspAmendmentDesc) },
    { label: 'Amendment authority', value: dash(fsp.amendmentAuthority) },
  ];

  // Matches the legacy FSP300 Y/N-with-link convention. All three
  // entries open as dialogs:
  //   Amendment Description     visible only when amendment_code = 'AMD'
  //   Replacement Description   visible only when amendment_code = 'RPL'
  //   Extension Summary         visible whenever fsp_extension_stat != 'N'
  const hasAmendmentDescription = fsp.fspAmendmentCode === 'AMD';
  const hasReplacementDescription = fsp.fspAmendmentCode === 'RPL';
  const hasExtensionSummary =
    !!fsp.fspExtensionStat && fsp.fspExtensionStat !== 'N';

  const termAndDates: FieldEntry[] = [
    { label: 'Effective date', value: dash(fsp.fspPlanStartDate) },
    { label: 'Expiry date', value: dash(fsp.fspExpiryDate) },
    { label: 'Submission date', value: dash(fsp.fspPlanSubmissionDate) },
    { label: 'Term', value: formatTerm(fsp.fspPlanTermYears, fsp.fspPlanTermMonths) },
    { label: 'Plan end date', value: dash(fsp.fspPlanEndDate) },
  ];

  const flags: FieldEntry[] = [
    { label: 'Transitional FSP', value: yesNo(fsp.transitionInd) },
    { label: 'FRPA 197 election', value: yesNo(fsp.frpa197electionInd) },
  ];

  const contact: FieldEntry[] = [
    { label: 'Contact name', value: dash(fsp.fspContactName) },
    { label: 'Telephone', value: dash(fsp.fspTelephoneNumber) },
    { label: 'E-mail address', value: dash(fsp.fspEmailAddress) },
  ];

  const agreementHolders = fsp.agreementHolders ?? [];
  const districts = fsp.districts ?? [];

  const agreementHolderRows = agreementHolders.map((h, i) => ({
    id: `${h.clientNumber ?? 'ah'}-${i}`,
    clientNumber: dash(h.clientNumber),
    clientName: dash(h.clientName),
    agreement: dash(h.agreementDescription),
    associatedFoms: dash(h.associatedFoms),
  }));


  return (
    <div>
      {!editing && canEdit && (
        <div className="fsp-info__tab-actions">
          <Button kind="tertiary" size="sm" renderIcon={Edit} onClick={handleEdit}>
            Edit
          </Button>
        </div>
      )}

      <div className="fsp-info__tiles-grid">
        {/* Plan Details */}
        <section className="fsp-info__tile">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Plan details</h2>
          </header>
          {editing ? (
            <div className="fsp-info__edit-grid">
              <TextInput
                id="edit-fspPlanName"
                labelText="FSP name"
                value={form.fspPlanName}
                maxLength={MAX.fspPlanName}
                invalid={!!errors.fspPlanName}
                invalidText={errors.fspPlanName}
                disabled={saving}
                onChange={(e) => setField('fspPlanName', e.target.value)}
              />
              <TextInput
                id="edit-amendmentName"
                labelText="Amendment name"
                value={form.amendmentName}
                maxLength={MAX.amendmentName}
                invalid={!!errors.amendmentName}
                invalidText={errors.amendmentName}
                disabled={saving}
                onChange={(e) => setField('amendmentName', e.target.value)}
              />
              <TextInput
                id="edit-amendmentAuthority"
                labelText="Amendment authority"
                value={form.amendmentAuthority}
                maxLength={MAX.amendmentAuthority}
                invalid={!!errors.amendmentAuthority}
                invalidText={errors.amendmentAuthority}
                disabled={saving}
                onChange={(e) => setField('amendmentAuthority', e.target.value)}
              />
              <TextArea
                id="edit-amendmentReason"
                labelText="Amendment reason"
                value={form.amendmentReason}
                maxLength={MAX.amendmentReason}
                rows={3}
                invalid={!!errors.amendmentReason}
                invalidText={errors.amendmentReason}
                disabled={saving}
                onChange={(e) => setField('amendmentReason', e.target.value)}
              />
            </div>
          ) : (
            <dl className="fsp-info__field-list">
              {planDetails.map((f) => (
                <Field key={f.label} {...f} />
              ))}
            </dl>
          )}
        </section>

        {/* Related Forms — Y/N + navigation buttons matching the
            legacy FSP300 "Amendment Description / Replacement
            Description / Extension Summary" rows. Each row shows "Y"
            with an Open button when applicable, "—" otherwise. */}
        {!editing && (
          <section className="fsp-info__tile">
            <header className="fsp-info__tile-header">
              <h2 className="fsp-info__section-title">Related forms</h2>
            </header>
            <dl className="fsp-info__field-list">
              <div className="fsp-info__field">
                <dt>Amendment description</dt>
                <dd>
                  {hasAmendmentDescription ? (
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Edit}
                      onClick={() => setAmendmentDialog('Amendment Description')}
                    >
                      Open
                    </Button>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="fsp-info__field">
                <dt>Replacement description</dt>
                <dd>
                  {hasReplacementDescription ? (
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Edit}
                      onClick={() => setAmendmentDialog('Replacement Description')}
                    >
                      Open
                    </Button>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="fsp-info__field">
                <dt>Extension summary</dt>
                <dd>
                  {hasExtensionSummary ? (
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Edit}
                      onClick={() => setExtensionSummaryOpen(true)}
                    >
                      View
                    </Button>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {/* Term & Dates */}
        <section className="fsp-info__tile">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Term &amp; dates</h2>
          </header>
          {editing ? (
            <div className="fsp-info__edit-grid">
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={form.fspPlanStartDate || undefined}
                onChange={(dates: Date[]) =>
                  setField('fspPlanStartDate', dates[0] ? toIsoDate(dates[0]) : '')
                }
              >
                <DatePickerInput
                  id="edit-fspPlanStartDate"
                  placeholder="YYYY-MM-DD"
                  labelText="Effective date"
                  disabled={saving}
                />
              </DatePicker>
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={form.fspExpiryDate || undefined}
                onChange={(dates: Date[]) =>
                  setField('fspExpiryDate', dates[0] ? toIsoDate(dates[0]) : '')
                }
              >
                <DatePickerInput
                  id="edit-fspExpiryDate"
                  placeholder="YYYY-MM-DD"
                  labelText="Expiry date"
                  disabled={saving}
                />
              </DatePicker>
              {/*
                Term + Plan End Date share one column of the 2-col edit
                grid so Plan End Date sits directly under Term (the
                right column of this row stays empty by design — matches
                the legacy 5-year-cap layout where Plan End Date is the
                fallback / alternative entry to the term).
              */}
              <div className="fsp-info__edit-stack">
                <fieldset className="fsp-info__term-group">
                  <legend className="fsp-info__term-legend">Term</legend>
                  {/*
                    Inline styles set the flex layout + cell widths.
                    The .fsp-info__term-inputs class anchors a separate
                    SCSS rule that resets Carbon's hard-coded 9.375rem
                    min-inline-size on the inner <input>, which is what
                    was actually overflowing the cell.
                  */}
                  <div
                    className="fsp-info__term-inputs"
                    style={{ display: 'flex', gap: '1rem' }}
                  >
                    <div style={{ width: '5rem', flex: '0 0 5rem' }}>
                      <NumberInput
                        id="edit-fspPlanTermYears"
                        label="Years"
                        min={0}
                        max={99}
                        allowEmpty
                        hideSteppers
                        value={form.fspPlanTermYears === '' ? '' : Number(form.fspPlanTermYears)}
                        invalid={!!errors.fspPlanTermYears}
                        invalidText={errors.fspPlanTermYears}
                        disabled={saving}
                        onChange={(_e, { value }) =>
                          setField('fspPlanTermYears', value === '' ? '' : String(value))
                        }
                      />
                    </div>
                    <div style={{ width: '5rem', flex: '0 0 5rem' }}>
                      <NumberInput
                        id="edit-fspPlanTermMonths"
                        label="Months"
                        min={0}
                        max={11}
                        allowEmpty
                        hideSteppers
                        value={form.fspPlanTermMonths === '' ? '' : Number(form.fspPlanTermMonths)}
                        invalid={!!errors.fspPlanTermMonths}
                        invalidText={errors.fspPlanTermMonths}
                        disabled={saving}
                        onChange={(_e, { value }) =>
                          setField('fspPlanTermMonths', value === '' ? '' : String(value))
                        }
                      />
                    </div>
                  </div>
                </fieldset>
                <DatePicker
                  datePickerType="single"
                  dateFormat="Y-m-d"
                  value={form.fspPlanEndDate || undefined}
                  onChange={(dates: Date[]) =>
                    setField('fspPlanEndDate', dates[0] ? toIsoDate(dates[0]) : '')
                  }
                >
                  <DatePickerInput
                    id="edit-fspPlanEndDate"
                    placeholder="YYYY-MM-DD"
                    labelText="Plan end date"
                    disabled={saving}
                  />
                </DatePicker>
              </div>
            </div>
          ) : (
            <dl className="fsp-info__field-list">
              {termAndDates.map((f) => (
                <Field key={f.label} {...f} />
              ))}
            </dl>
          )}
        </section>

        {/* Contact */}
        <section className="fsp-info__tile">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Contact</h2>
          </header>
          {editing ? (
            <div className="fsp-info__edit-grid">
              <TextInput
                id="edit-fspContactName"
                labelText="Contact name"
                value={form.fspContactName}
                maxLength={MAX.fspContactName}
                invalid={!!errors.fspContactName}
                invalidText={errors.fspContactName}
                disabled={saving}
                onChange={(e) => setField('fspContactName', e.target.value)}
              />
              <TextInput
                id="edit-fspTelephoneNumber"
                labelText="Telephone"
                helperText="10 digits, no separators"
                value={form.fspTelephoneNumber}
                maxLength={MAX.fspTelephoneNumber}
                invalid={!!errors.fspTelephoneNumber}
                invalidText={errors.fspTelephoneNumber}
                disabled={saving}
                onChange={(e) =>
                  setField('fspTelephoneNumber', e.target.value.replace(/\D/g, ''))
                }
              />
              <TextInput
                id="edit-fspEmailAddress"
                labelText="E-mail address"
                value={form.fspEmailAddress}
                maxLength={MAX.fspEmailAddress}
                invalid={!!errors.fspEmailAddress}
                invalidText={errors.fspEmailAddress}
                disabled={saving}
                onChange={(e) => setField('fspEmailAddress', e.target.value)}
              />
            </div>
          ) : (
            <dl className="fsp-info__field-list">
              {contact.map((f) => (
                <Field key={f.label} {...f} />
              ))}
            </dl>
          )}
        </section>

        {/* Flags */}
        <section className="fsp-info__tile">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Flags</h2>
          </header>
          {editing ? (
            <div className="fsp-info__edit-grid fsp-info__edit-grid--toggles">
              <Toggle
                id="edit-transitionInd"
                labelText="Transitional FSP"
                labelA="No"
                labelB="Yes"
                toggled={form.transitionInd}
                disabled={saving}
                onToggle={(v) => setField('transitionInd', v)}
              />
              <Toggle
                id="edit-frpa197electionInd"
                labelText="FRPA 197 election"
                labelA="No"
                labelB="Yes"
                toggled={form.frpa197electionInd}
                disabled={saving}
                onToggle={(v) => setField('frpa197electionInd', v)}
              />
            </div>
          ) : (
            <dl className="fsp-info__field-list">
              {flags.map((f) => (
                <Field key={f.label} {...f} />
              ))}
            </dl>
          )}
        </section>

        {/* Agreement Holders — row-edit deferred; Add wired via the
            ClientSearchModal so a holder can be picked from FOREST_CLIENT
            and persisted without going through the scalar edit mode. */}
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Agreement holders</h2>
            {canEdit && (
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Add}
                onClick={() => setClientPickerOpen(true)}
              >
                Add agreement holder
              </Button>
            )}
          </header>
          {agreementHolderRows.length === 0 ? (
            <p>No agreement holders linked to this FSP.</p>
          ) : (
            <div className="bordered-table">
              <DataTable
                rows={agreementHolderRows}
                headers={[
                  { key: 'clientNumber', header: 'Client #' },
                  { key: 'clientName', header: 'Client name' },
                  { key: 'agreement', header: 'License' },
                  { key: 'associatedFoms', header: 'Associated FOMs' },
                ]}
                isSortable
              >
                {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
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
                        {rows.map((row) => (
                          <TableRow {...getRowProps({ row })} key={row.id}>
                            {row.cells.map((cell) => (
                              <TableCell key={cell.id}>{cell.value as string}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            </div>
          )}
        </section>

        {/* Districts — Add wired via the DistrictPickerModal autocomplete
            (Carbon ComboBox over getOrgUnits). */}
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Districts</h2>
            {canEdit && (
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Add}
                onClick={() => setDistrictPickerOpen(true)}
              >
                Add district
              </Button>
            )}
          </header>
          {districts.length === 0 ? (
            <p>No districts linked to this FSP.</p>
          ) : (
            <div className="bordered-table">
              <TableContainer>
                <Table size="md" useZebraStyles>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Code</TableHeader>
                      <TableHeader>Name</TableHeader>
                      <TableHeader style={{ width: '4rem' }} aria-label="Actions" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {districts.map((d, i) => (
                      <TableRow
                        key={d.orgUnitNo ?? d.orgUnitCode ?? `row-${i}`}
                      >
                        <TableCell>{dash(d.orgUnitCode)}</TableCell>
                        <TableCell>{dash(d.orgUnitName)}</TableCell>
                        <TableCell>
                          {canEdit && (
                            <Button
                              kind="ghost"
                              size="sm"
                              renderIcon={TrashCan}
                              iconDescription="Remove"
                              hasIconOnly
                              disabled={!d.orgUnitNo}
                              onClick={() => setDistrictDeleteTarget(d)}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
          )}
        </section>
      </div>

      {editing && (
        <div className="fsp-info__form-actions">
          <Button kind="secondary" size="sm" disabled={saving} onClick={handleCancel}>
            Cancel
          </Button>
          <Button kind="primary" size="sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}

      <ClientSearchModal
        open={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        onSelect={(client) => {
          void handleAddHolder(client).catch((err) => {
            display({
              kind: 'error',
              title: 'Failed to add agreement holder',
              subtitle: err instanceof Error ? err.message : 'Unknown error',
              timeout: 9000,
            });
          });
        }}
      />

      <DistrictPickerModal
        open={districtPickerOpen}
        onClose={() => setDistrictPickerOpen(false)}
        excludeOrgUnitNos={(fsp.districts ?? [])
          .map((d) => d.orgUnitNo)
          .filter((c): c is string => !!c)}
        onSelect={handleAddDistrict}
      />

      <ConfirmationModal
        open={districtDeleteTarget != null}
        onClose={() => setDistrictDeleteTarget(null)}
        heading="Remove district"
        confirmLabel="Remove"
        danger
        errorTitle="Failed to remove district"
        onConfirm={handleDeleteDistrictConfirmed}
      >
        <p>
          Remove district{' '}
          <strong>
            {districtDeleteTarget?.orgUnitCode ??
              districtDeleteTarget?.orgUnitNo ??
              '(unnamed)'}
            {districtDeleteTarget?.orgUnitName
              ? ` — ${districtDeleteTarget.orgUnitName}`
              : ''}
          </strong>{' '}
          from this FSP? This cannot be undone.
        </p>
      </ConfirmationModal>
      <AmendmentDescriptionModal
        open={amendmentDialog != null}
        fsp={fsp}
        heading={amendmentDialog ?? 'Amendment Description'}
        onClose={() => setAmendmentDialog(null)}
        onSaved={onSaved}
      />
      <ExtensionSummaryModal
        open={extensionSummaryOpen}
        fspId={fsp.fspId}
        onClose={() => setExtensionSummaryOpen(false)}
      />
    </div>
  );
};

/** Carbon DatePicker emits Date objects; the proc wants YYYY-MM-DD. */
function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default InformationTab;
