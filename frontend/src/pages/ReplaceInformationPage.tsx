import { useState } from 'react';
import { RadioButton, RadioButtonGroup, Checkbox, Button, TextArea } from '@carbon/react';
import { Save, Reset } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface ReplaceForm {
  fduUpdate: string;
  areasUpdate: string;
  stockingUpdate: string;
  approvalRequired: boolean;
  summaryOfChanges: string;
}

export default function ReplaceInformationPage() {
  const [form, setForm] = useState<ReplaceForm>({
    fduUpdate: 'N', areasUpdate: 'N', stockingUpdate: 'N',
    approvalRequired: false, summaryOfChanges: '',
  });
  const set = <K extends keyof ReplaceForm>(k: K, v: ReplaceForm[K]) => setForm(f => ({ ...f, [k]: v }));

  return (
    <PageLayout title="Replacement Information">
      <FspTombstone fspId="10001" amendNo="2" status="Draft" />
      <FspTabStrip />

      <div className="form-section">
        <div className="form-section__title">Does this replacement amendment change any of the following?</div>
        <div className="radio-stack">
          <RadioButtonGroup legendText="FDU Changes" name="fduUpdate" valueSelected={form.fduUpdate} onChange={v => set('fduUpdate', v as string)} orientation="horizontal">
            <RadioButton labelText="Yes" value="Y" id="rfduY" /><RadioButton labelText="No" value="N" id="rfduN" />
          </RadioButtonGroup>
          <RadioButtonGroup legendText="Identified/Declared Area Changes" name="areasUpdate" valueSelected={form.areasUpdate} onChange={v => set('areasUpdate', v as string)} orientation="horizontal">
            <RadioButton labelText="Yes" value="Y" id="rareasY" /><RadioButton labelText="No" value="N" id="rareasN" />
          </RadioButtonGroup>
          <RadioButtonGroup legendText="Stocking Standard Changes" name="stockingUpdate" valueSelected={form.stockingUpdate} onChange={v => set('stockingUpdate', v as string)} orientation="horizontal">
            <RadioButton labelText="Yes" value="Y" id="rstockY" /><RadioButton labelText="No" value="N" id="rstockN" />
          </RadioButtonGroup>
        </div>
      </div>

      <div className="form-section">
        <Checkbox id="approvalRequired" labelText="Replacement amendment requires approval" checked={form.approvalRequired} disabled />
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
