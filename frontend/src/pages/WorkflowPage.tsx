import { useState } from 'react';
import { Checkbox, TextArea, Button, RadioButton, RadioButtonGroup } from '@carbon/react';
import { Save } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface ReviewItem {
  key: string;
  label: string;
}

interface ReviewState {
  completed: boolean;
  userId: string;
  date: string;
  comment: string;
}

const REVIEW_ITEMS: ReviewItem[] = [
  { key: 'fnr',  label: 'First Nations Review' },
  { key: 'rs',   label: 'Results & Strategies reviewed by C&E' },
  { key: 'oth',  label: 'Other Review Items' },
];

export default function WorkflowPage() {
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(
    Object.fromEntries(REVIEW_ITEMS.map(r => [r.key, { completed: false, userId: '', date: '', comment: '' }]))
  );
  const [ddmDecision, setDdmDecision] = useState('');
  const [ddmComment, setDdmComment]   = useState('');

  const setReview = <K extends keyof ReviewState>(key: string, field: K, value: ReviewState[K]) =>
    setReviews(r => ({ ...r, [key]: { ...r[key], [field]: value } }));

  return (
    <PageLayout title="Workflow">
      <FspTombstone fspId="10001" amendNo="1" status="Submitted" />
      <FspTabStrip />

      {/* Review Details */}
      <div className="form-section">
        <div className="form-section__title">Review Details (Optional)</div>
        <table className="results-table">
          <thead>
            <tr>
              <th style={{ width: '5%' }}>Complete</th>
              <th style={{ width: '30%' }}>Item</th>
              <th style={{ width: '10%' }}>User ID</th>
              <th style={{ width: '15%' }}>Date</th>
              <th style={{ width: '30%' }}>Comments / Rationale</th>
              <th style={{ width: '10%' }}></th>
            </tr>
          </thead>
          <tbody>
            {REVIEW_ITEMS.map(item => (
              <tr key={item.key}>
                <td style={{ textAlign: 'center' }}>
                  <Checkbox
                    id={`chk-${item.key}`}
                    labelText=""
                    hideLabel
                    checked={reviews[item.key].completed}
                    onChange={(_, { checked }) => setReview(item.key, 'completed', checked)}
                  />
                </td>
                <td>{item.label}</td>
                <td style={{ color: '#6f6f6f', fontSize: '0.8rem' }}>—</td>
                <td style={{ color: '#6f6f6f', fontSize: '0.8rem' }}>—</td>
                <td>
                  <TextArea
                    id={`comment-${item.key}`}
                    labelText="Comment"
                    hideLabel
                    value={reviews[item.key].comment}
                    onChange={e => setReview(item.key, 'comment', e.target.value)}
                    rows={2}
                    disabled={reviews[item.key].completed}
                  />
                </td>
                <td>
                  <Button kind="primary" size="sm" renderIcon={Save}>Save</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DDM Decision */}
      <div className="form-section">
        <div className="form-section__title">DDM Decision</div>
        <RadioButtonGroup legendText="Decision" name="ddmDecision" valueSelected={ddmDecision} onChange={v => setDdmDecision(v as string)} orientation="horizontal">
          <RadioButton labelText="Approved"      value="APP" id="ddmApp" />
          <RadioButton labelText="Rejected"      value="REJ" id="ddmRej" />
          <RadioButton labelText="Clarification" value="CLR" id="ddmClr" />
        </RadioButtonGroup>
        <div style={{ marginTop: '1rem' }}>
          <TextArea id="ddmComment" labelText="DDM Comments" value={ddmComment} onChange={e => setDdmComment(e.target.value)} rows={5} />
        </div>
        <div className="form-actions">
          <Button kind="primary" renderIcon={Save}>Save DDM Decision</Button>
        </div>
      </div>
    </PageLayout>
  );
}
