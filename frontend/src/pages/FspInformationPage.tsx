import { useState } from 'react';
import {
  TextInput, Select, SelectItem, DatePicker, DatePickerInput,
  RadioButton, RadioButtonGroup, Button, TextArea, NumberInput,
} from '@carbon/react';
import { Save, Reset } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

const AMENDMENT_TYPES = [
  { value: '',    label: '' },
  { value: 'AMD', label: 'Amendment' },
  { value: 'RPL', label: 'Replacement' },
  { value: 'EXT', label: 'Extension' },
];

interface FspInfoForm {
  fspId: string;
  planName: string;
  orgUnit: string;
  holder: string;
  holderName: string;
  contactName: string;
  phone: string;
  email: string;
  effectiveDate: string;
  expiryDate: string;
  termYears: string | number;
  termMonths: string | number;
  amendmentCode: string;
  approvalRequired: string;
  frpaObjectives: string;
  additionalInfo: string;
}

export default function FspInformationPage() {
  const [form, setForm] = useState<FspInfoForm>({
    fspId: '', planName: '', orgUnit: '', holder: '', holderName: '',
    contactName: '', phone: '', email: '',
    effectiveDate: '', expiryDate: '', termYears: '', termMonths: '',
    amendmentCode: '', approvalRequired: 'N',
    frpaObjectives: '', additionalInfo: '',
  });

  const set = <K extends keyof FspInfoForm>(k: K, v: FspInfoForm[K]) => setForm(f => ({ ...f, [k]: v }));

  return (
    <PageLayout title="FSP Information">
      <FspTombstone fspId={form.fspId || 'New'} amendNo="0" status="Draft" />
      <FspTabStrip />

      {/* Basic Info */}
      <div className="form-section">
        <div className="form-section__title">Plan Details</div>
        <div className="search-grid">
          <TextInput id="fspId"      labelText="FSP ID"      value={form.fspId}      onChange={e => set('fspId', e.target.value)}      maxLength={10} />
          <TextInput id="planName"   labelText="FSP Name"    value={form.planName}   onChange={e => set('planName', e.target.value)}   maxLength={120} />
          <Select id="orgUnit" labelText="Organization Unit" value={form.orgUnit} onChange={e => set('orgUnit', e.target.value)}>
            <SelectItem value="" text="" />
            <SelectItem value="DPG" text="DPG – Penticton" />
            <SelectItem value="DSE" text="DSE – Skeena" />
            <SelectItem value="DQU" text="DQU – Quesnel" />
          </Select>
          <Select id="amendmentCode" labelText="Amendment Type" value={form.amendmentCode} onChange={e => set('amendmentCode', e.target.value)}>
            {AMENDMENT_TYPES.map(o => <SelectItem key={o.value} value={o.value} text={o.label} />)}
          </Select>
        </div>
      </div>

      {/* Agreement Holder */}
      <div className="form-section">
        <div className="form-section__title">Agreement Holder</div>
        <div className="search-grid">
          <TextInput id="holder"     labelText="Holder ID"   value={form.holder}     onChange={e => set('holder', e.target.value)}     maxLength={8} />
          <TextInput id="holderName" labelText="Holder Name" value={form.holderName} onChange={e => set('holderName', e.target.value)} maxLength={200} />
          <TextInput id="contact"    labelText="Contact Name" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
          <TextInput id="phone"      labelText="Phone"       value={form.phone}      onChange={e => set('phone', e.target.value)}      maxLength={10} />
          <TextInput id="email"      labelText="Email"       value={form.email}      onChange={e => set('email', e.target.value)}      type="email" />
        </div>
      </div>

      {/* Dates & Term */}
      <div className="form-section">
        <div className="form-section__title">Dates &amp; Term</div>
        <div className="search-grid">
          <DatePicker datePickerType="single" dateFormat="Y-m-d">
            <DatePickerInput id="effectiveDate" labelText="Effective Date (YYYY-MM-DD)" placeholder="YYYY-MM-DD" />
          </DatePicker>
          <DatePicker datePickerType="single" dateFormat="Y-m-d">
            <DatePickerInput id="expiryDate" labelText="Expiry Date (YYYY-MM-DD)" placeholder="YYYY-MM-DD" />
          </DatePicker>
          <NumberInput id="termYears"  label="Term (Years)"  value={form.termYears as number}  onChange={(_e, { value }) => set('termYears', value)}  min={0} max={99} />
          <NumberInput id="termMonths" label="Term (Months)" value={form.termMonths as number} onChange={(_e, { value }) => set('termMonths', value)} min={0} max={11} />
        </div>
      </div>

      {/* Approval */}
      <div className="form-section">
        <div className="form-section__title">Approval</div>
        <RadioButtonGroup
          legendText="Approval Required"
          name="approvalRequired"
          valueSelected={form.approvalRequired}
          onChange={v => set('approvalRequired', v as string)}
        >
          <RadioButton labelText="Yes" value="Y" id="approvalY" />
          <RadioButton labelText="No"  value="N" id="approvalN" />
        </RadioButtonGroup>
      </div>

      {/* Additional Info */}
      <div className="form-section">
        <div className="form-section__title">Additional Information</div>
        <TextArea
          id="additionalInfo"
          labelText="Notes / Additional Information"
          value={form.additionalInfo}
          onChange={e => set('additionalInfo', e.target.value)}
          rows={6}
        />
      </div>

      <div className="form-actions">
        <Button kind="primary"   renderIcon={Save}>Save</Button>
        <Button kind="secondary" renderIcon={Reset}>Clear</Button>
        <Button kind="danger">Submit FSP</Button>
      </div>

      <style>{`.search-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem 1.5rem; }`}</style>
    </PageLayout>
  );
}
