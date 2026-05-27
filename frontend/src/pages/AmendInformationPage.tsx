import { useState } from 'react';
import { RadioButton, RadioButtonGroup, Button, TextArea } from '@carbon/react';
import { Save, Reset } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface AmendForm {
  fduUpdate: string;
  areasUpdate: string;
  stockingUpdate: string;
  approvalRequired: string;
  summaryOfChanges: string;
}

export default function AmendInformationPage() {
  const [form, setForm] = useState<AmendForm>({
    fduUpdate: 'N', areasUpdate: 'N', stockingUpdate: 'N',
    approvalRequired: 'N', summaryOfChanges: '',
  });
  const set = <K extends keyof AmendForm>(k: K, v: AmendForm[K]) => setForm(f => ({ ...f, [k]: v }));

  return (
    <PageLayout title="Amendment Information">
      <FspTombstone fspId="10001" amendNo="1" status="Draft" />
      <FspTabStrip />

      <div className="form-section">
        <div className="form-section__title">Does this amendment change any of the following?</div>
        <div className="radio-stack">
          <RadioButtonGroup legendText="FDU Changes" name="fduUpdate" valueSelected={form.fduUpdate} onChange={v => set('fduUpdate', v as string)} orientation="horizontal">
            <RadioButton labelText="Yes" value="Y" id="fduY" />
            <RadioButton labelText="No"  value="N" id="fduN" />
          </RadioButtonGroup>
          <RadioButtonGroup legendText="Identified/Declared Area Changes" name="areasUpdate" valueSelected={form.areasUpdate} onChange={v => set('areasUpdate', v as string)} orientation="horizontal">
            <RadioButton labelText="Yes" value="Y" id="areasY" />
            <RadioButton labelText="No"  value="N" id="areasN" />
          </RadioButtonGroup>
          <RadioButtonGroup legendText="Stocking Standard Changes" name="stockingUpdate" valueSelected={form.stockingUpdate} onChange={v => set('stockingUpdate', v as string)} orientation="horizontal">
            <RadioButton labelText="Yes" value="Y" id="stockY" />
            <RadioButton labelText="No"  value="N" id="stockN" />
          </RadioButtonGroup>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Does this amendment require approval?</div>
        <RadioButtonGroup legendText="Approval Required" name="approvalRequired" valueSelected={form.approvalRequired} onChange={v => set('approvalRequired', v as string)} orientation="horizontal">
          <RadioButton labelText="Yes" value="Y" id="appY" />
          <RadioButton labelText="No"  value="N" id="appN" />
        </RadioButtonGroup>
      </div>

      <div className="form-section">
        <div className="form-section__title">Summary of Changes</div>
        <TextArea id="summaryOfChanges" labelText="Summary" value={form.summaryOfChanges} onChange={e => set('summaryOfChanges', e.target.value)} rows={10} />
      </div>

      <div className="form-actions">
        <Button kind="primary" renderIcon={Save}>Save</Button>
        <Button kind="secondary" renderIcon={Reset}>Clear</Button>
      </div>

      <style>{`.radio-stack { display: flex; flex-direction: column; gap: 1.25rem; }`}</style>
    </PageLayout>
  );
}
