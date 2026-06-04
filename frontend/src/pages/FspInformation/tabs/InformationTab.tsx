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
import {Edit} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

import {useNotification} from '@/context/notification/useNotification';
import {type FspInformation, updateFsp} from '@/services/fspSearch';

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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(
    fsp ? createFormState(fsp) : null,
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

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

  // ─── Read-only field lists ──────────────────────────────────────────

  const planDetails: FieldEntry[] = [
    { label: 'FSP Name', value: dash(fsp.fspPlanName) },
    { label: 'Status', value: dash(fsp.fspStatusDesc) },
    { label: 'Amendment Name', value: dash(fsp.amendmentName) },
    { label: 'Amendment Type', value: dash(fsp.fspAmendmentDesc) },
    { label: 'Amendment Authority', value: dash(fsp.amendmentAuthority) },
    { label: 'Revision', value: dash(fsp.revisionCount) },
  ];

  const termAndDates: FieldEntry[] = [
    { label: 'Effective Date', value: dash(fsp.fspPlanStartDate) },
    { label: 'Expiry Date', value: dash(fsp.fspExpiryDate) },
    { label: 'Submission Date', value: dash(fsp.fspPlanSubmissionDate) },
    { label: 'Term (Years)', value: dash(fsp.fspPlanTermYears) },
    { label: 'Term (Months)', value: dash(fsp.fspPlanTermMonths) },
    { label: 'Plan End Date', value: dash(fsp.fspPlanEndDate) },
  ];

  const flags: FieldEntry[] = [
    { label: 'Transitional FSP', value: yesNo(fsp.transitionInd) },
    { label: 'FRPA 197 Election', value: yesNo(fsp.frpa197electionInd) },
  ];

  const contact: FieldEntry[] = [
    { label: 'Contact Name', value: dash(fsp.fspContactName) },
    { label: 'Telephone', value: dash(fsp.fspTelephoneNumber) },
    { label: 'E-mail Address', value: dash(fsp.fspEmailAddress) },
  ];

  const agreementHolders = fsp.agreementHolders ?? [];
  const districts = fsp.districts ?? [];

  const agreementHolderRows = agreementHolders.map((h, i) => ({
    id: `${h.clientNumber ?? 'ah'}-${i}`,
    clientNumber: dash(h.clientNumber),
    clientName: dash(h.clientName),
    agreement: dash(h.agreementDescription),
  }));

  const districtRows = districts.map((d, i) => ({
    id: d.orgUnitNo ?? d.orgUnitCode ?? `row-${i}`,
    code: dash(d.orgUnitCode),
    name: dash(d.orgUnitName),
  }));

  return (
    <div>
      {!editing && (
        <div className="fsp-info__tab-actions">
          <Button kind="primary" size="sm" renderIcon={Edit} onClick={handleEdit}>
            Edit
          </Button>
        </div>
      )}

      <div className="fsp-info__tiles-grid">
        {/* Plan Details */}
        <section className="fsp-info__tile">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Plan Details</h2>
          </header>
          {editing ? (
            <div className="fsp-info__edit-grid">
              <TextInput
                id="edit-fspPlanName"
                labelText="FSP Name"
                value={form.fspPlanName}
                maxLength={MAX.fspPlanName}
                invalid={!!errors.fspPlanName}
                invalidText={errors.fspPlanName}
                disabled={saving}
                onChange={(e) => setField('fspPlanName', e.target.value)}
              />
              <TextInput
                id="edit-amendmentName"
                labelText="Amendment Name"
                value={form.amendmentName}
                maxLength={MAX.amendmentName}
                invalid={!!errors.amendmentName}
                invalidText={errors.amendmentName}
                disabled={saving}
                onChange={(e) => setField('amendmentName', e.target.value)}
              />
              <TextInput
                id="edit-amendmentAuthority"
                labelText="Amendment Authority"
                value={form.amendmentAuthority}
                maxLength={MAX.amendmentAuthority}
                invalid={!!errors.amendmentAuthority}
                invalidText={errors.amendmentAuthority}
                disabled={saving}
                onChange={(e) => setField('amendmentAuthority', e.target.value)}
              />
              <TextArea
                id="edit-amendmentReason"
                labelText="Amendment Reason"
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

        {/* Term & Dates */}
        <section className="fsp-info__tile">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Term &amp; Dates</h2>
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
                  labelText="Effective Date"
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
                  labelText="Expiry Date"
                  disabled={saving}
                />
              </DatePicker>
              <NumberInput
                id="edit-fspPlanTermYears"
                label="Term (Years)"
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
              <NumberInput
                id="edit-fspPlanTermMonths"
                label="Term (Months)"
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
                  labelText="Plan End Date"
                  disabled={saving}
                />
              </DatePicker>
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
                labelText="Contact Name"
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
                labelText="E-mail Address"
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
                labelText="FRPA 197 Election"
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

        {/* Agreement Holders — read-only for now (row-edit is its own UX) */}
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Agreement Holders</h2>
          </header>
          {agreementHolderRows.length === 0 ? (
            <p>No agreement holders linked to this FSP.</p>
          ) : (
            <div className="bordered-table">
              <DataTable
                rows={agreementHolderRows}
                headers={[
                  { key: 'clientNumber', header: 'Client #' },
                  { key: 'clientName', header: 'Client Name' },
                  { key: 'agreement', header: 'Agreement' },
                ]}
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

        {/* Districts — read-only for now */}
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Districts</h2>
          </header>
          {districtRows.length === 0 ? (
            <p>No districts linked to this FSP.</p>
          ) : (
            <div className="bordered-table">
              <DataTable
                rows={districtRows}
                headers={[
                  { key: 'code', header: 'Code' },
                  { key: 'name', header: 'Name' },
                ]}
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
