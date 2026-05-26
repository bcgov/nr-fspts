import { useState } from 'react';
import { TextInput, Button } from '@carbon/react';
import { Map, TrashCan, Save } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface Fdu {
  id: string;
  name: string;
  licences: string[];
  hasMap: boolean;
}

const MOCK_FDUS: Fdu[] = [
  { id: 'FDU001', name: 'South Okanagan FDU', licences: ['A12345', 'A67890'], hasMap: true },
  { id: 'FDU002', name: 'North Okanagan FDU', licences: ['A11111'],            hasMap: true },
  { id: 'FDU003', name: 'East Kootenay FDU',  licences: [],                   hasMap: false },
];

export default function FduMapPage() {
  const [fdus] = useState<Fdu[]>(MOCK_FDUS);
  const [newLicence, setNewLicence] = useState('');

  return (
    <PageLayout title="FDU / Map">
      <FspTombstone fspId="10001" amendNo="1" status="Draft" />
      <FspTabStrip />

      <p className="form-section__title" style={{ marginBottom: '1rem' }}>
        FDU records with spatial from Amendment # 1
      </p>

      {fdus.map(fdu => (
        <div key={fdu.id} className="fdu-block">
          <div className="fdu-block__header">
            <strong>{fdu.name}</strong>
            {fdu.hasMap && (
              <Button kind="ghost" size="sm" renderIcon={Map}>Map View</Button>
            )}
          </div>

          {/* Licence list */}
          <table className="results-table" style={{ marginBottom: '0.5rem' }}>
            <thead><tr><th>Licence</th><th></th></tr></thead>
            <tbody>
              {fdu.licences.length === 0
                ? <tr><td colSpan={2} style={{ color: '#6f6f6f', fontStyle: 'italic' }}>No licences</td></tr>
                : fdu.licences.map(lic => (
                    <tr key={lic}>
                      <td>{lic}</td>
                      <td><Button kind="danger--ghost" size="sm" renderIcon={TrashCan} iconDescription="Delete" hasIconOnly /></td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {/* Add licence */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', maxWidth: 400 }}>
            <TextInput id={`newLic-${fdu.id}`} labelText="Add Licence (Forest File ID)" value={newLicence} onChange={e => setNewLicence(e.target.value)} maxLength={10} size="sm" />
            <Button kind="primary" size="sm" renderIcon={Save}>Save</Button>
            <Button kind="secondary" size="sm">Cancel</Button>
          </div>
        </div>
      ))}

      <style>{`
        .fdu-block { border: 1px solid #e0e0e0; border-left: 4px solid #003366; padding: 1rem; margin-bottom: 1.25rem; background: #fafafa; }
        .fdu-block__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
      `}</style>
    </PageLayout>
  );
}
