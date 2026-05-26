import { useState } from 'react';
import { TextInput, NumberInput, DatePicker, DatePickerInput, TextArea, Button, FileUploader } from '@carbon/react';
import { Save } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface ExtensionForm {
  termYears: string | number;
  termMonths: string | number;
  newExpiryDate: string;
  comments: string;
}

export default function ExtensionRequestPage() {
  const [form, setForm] = useState<ExtensionForm>({
    termYears: '', termMonths: '', newExpiryDate: '', comments: '',
  });
  const set = <K extends keyof ExtensionForm>(k: K, v: ExtensionForm[K]) => setForm(f => ({ ...f, [k]: v }));

  return (
    <PageLayout title="Extension Request">
      <FspTombstone fspId="10001" amendNo="0" status="Approved" expiryDate="2028-03-31" />
      <FspTabStrip />

      <div className="form-section">
        <div className="form-section__title">Current Details (Read Only)</div>
        <div className="search-grid">
          <TextInput id="origStart" labelText="FSP Effective Date"       value="2023-04-01" readOnly />
          <TextInput id="origEnd"   labelText="Original FSP Expiry Date" value="2028-03-31" readOnly />
          <TextInput id="currTerm"  labelText="Current Term"             value="5 yr 0 mo"  readOnly />
          <TextInput id="currEnd"   labelText="Current FSP Expiry Date"  value="2028-03-31" readOnly />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">New Extension</div>
        <div className="search-grid">
          <NumberInput id="termYears"  label="New Term (Years)"  value={form.termYears as number}  onChange={(_e, { value }) => set('termYears', value)}  min={0} max={99} />
          <NumberInput id="termMonths" label="New Term (Months)" value={form.termMonths as number} onChange={(_e, { value }) => set('termMonths', value)} min={0} max={11} />
          <DatePicker datePickerType="single" dateFormat="Y-m-d">
            <DatePickerInput id="newExpiryDate" labelText="New FSP Expiry Date (YYYY-MM-DD)" placeholder="YYYY-MM-DD" />
          </DatePicker>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Comments</div>
        <TextArea id="comments" labelText="Comments" value={form.comments} onChange={e => set('comments', e.target.value)} rows={8} />
      </div>

      <div className="form-section">
        <div className="form-section__title">Attachments</div>
        <FileUploader labelTitle="Upload supporting documents" labelDescription="Max file size: 10MB. Accepted file types: PDF, DOC, DOCX." buttonLabel="Add file" accept={['.pdf', '.doc', '.docx']} multiple filenameStatus="edit" />
      </div>

      <div className="form-actions">
        <Button kind="primary" renderIcon={Save}>Save</Button>
        <Button kind="secondary">Clear</Button>
      </div>
      <style>{`.search-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem 1.5rem; }`}</style>
    </PageLayout>
  );
}
