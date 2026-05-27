import { useState } from 'react';
import { Select, SelectItem, TextInput, Button, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@carbon/react';
import { Save, TrashCan } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import './PageLayout.css';

interface Designate {
  id: string;
  idir: string;
  email: string;
}

const MOCK_DESIGNATES: Designate[] = [
  { id: '1', idir: 'jsmith',    email: 'john.smith@gov.bc.ca' },
  { id: '2', idir: 'mbrown',    email: 'mary.brown@gov.bc.ca' },
  { id: '3', idir: 'twilliams', email: 'tom.williams@gov.bc.ca' },
];

const HEADERS = [
  { key: 'idir',  header: 'IDIR Username' },
  { key: 'email', header: 'E-Mail Address' },
];

export default function DistrictNotificationPage() {
  const [district, setDistrict]   = useState('');
  const [newIdir,  setNewIdir]    = useState('');
  const [results,  setResults]    = useState<Designate[] | null>(null);

  return (
    <PageLayout title="District Auto Notification">

      {/* District selector */}
      <div className="form-section">
        <div className="form-section__title">Select District</div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', maxWidth: 500 }}>
          <Select id="district" labelText="District" value={district} onChange={e => setDistrict(e.target.value)} style={{ flex: 1 }}>
            <SelectItem value=""    text="" />
            <SelectItem value="DPG" text="DPG – Penticton" />
            <SelectItem value="DSE" text="DSE – Skeena" />
            <SelectItem value="DQU" text="DQU – Quesnel" />
            <SelectItem value="DKA" text="DKA – Kamloops" />
          </Select>
          <Button kind="primary" onClick={() => setResults(MOCK_DESIGNATES)}>Go</Button>
        </div>
      </div>

      {/* Results + add row */}
      {results !== null && (
        <div className="form-section">
          <div className="form-section__title">District Notification Designates</div>

          {/* Add new row */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem', maxWidth: 600 }}>
            <TextInput
              id="newIdir"
              labelText="New IDIR Username"
              value={newIdir}
              onChange={e => setNewIdir(e.target.value)}
              maxLength={30}
              size="sm"
            />
            <Button kind="primary" size="sm" renderIcon={Save}>Save</Button>
          </div>

          <DataTable rows={results} headers={HEADERS}>
            {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()} size="sm">
                  <TableHead>
                    <TableRow>
                      {headers.map(h => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}
                      <TableHeader key="actions"></TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map(row => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map(cell => <TableCell key={cell.id}>{cell.value}</TableCell>)}
                        <TableCell>
                          <Button kind="danger--ghost" size="sm" renderIcon={TrashCan} iconDescription="Delete" hasIconOnly />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </div>
      )}
    </PageLayout>
  );
}
