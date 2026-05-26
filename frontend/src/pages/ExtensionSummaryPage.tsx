import { useState } from 'react';
import { TextInput, Button, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, Tag } from '@carbon/react';
import PageLayout from './PageLayout';
import { FspTombstone } from './FspShared';
import './PageLayout.css';

interface ExtensionRow {
  id: string;
  extNo: string;
  requestDate: string;
  status: string;
  decisionDate: string;
  term: string;
  expiryDate: string;
  effectiveDate: string;
  amendNo: string;
}

const MOCK_EXTENSIONS: ExtensionRow[] = [
  { id: '1', extNo: '1', requestDate: '2024-01-10', status: 'APP', decisionDate: '2024-02-01', term: '2 yr 0 mo', expiryDate: '2030-03-31', effectiveDate: '2024-02-15', amendNo: '0' },
  { id: '2', extNo: '2', requestDate: '2025-03-05', status: 'SUB', decisionDate: '—',           term: '1 yr 6 mo', expiryDate: '—',          effectiveDate: '—',          amendNo: '1' },
];

const HEADERS = [
  { key: 'extNo',         header: 'Extension #' },
  { key: 'requestDate',   header: 'Request Date' },
  { key: 'status',        header: 'Status' },
  { key: 'decisionDate',  header: 'Decision Date' },
  { key: 'term',          header: 'Term' },
  { key: 'expiryDate',    header: 'Expiry Date' },
  { key: 'effectiveDate', header: 'Effective Date' },
  { key: 'amendNo',       header: 'Amnd # in Effect' },
];

export default function ExtensionSummaryPage() {
  const [fspId, setFspId] = useState('10001');
  const [results, setResults] = useState<ExtensionRow[] | null>(MOCK_EXTENSIONS);

  return (
    <PageLayout title="Extension Summary">
      <div className="form-section">
        <div className="search-grid" style={{ maxWidth: 480 }}>
          <TextInput id="fspId" labelText="FSP ID" value={fspId} onChange={e => setFspId(e.target.value)} maxLength={10} />
          <TextInput id="planName" labelText="FSP Plan Name" value="Okanagan FSP 2023" readOnly />
          <TextInput id="origStart" labelText="FSP Effective Date" value="2023-04-01" readOnly />
          <TextInput id="origEnd"   labelText="Original FSP Expiry Date" value="2028-03-31" readOnly />
          <TextInput id="currTerm"  labelText="Current Term" value="5 yr 0 mo" readOnly />
          <TextInput id="currEnd"   labelText="Current FSP Expiry Date" value="2028-03-31" readOnly />
        </div>
        <div className="form-actions">
          <Button kind="primary" onClick={() => setResults(MOCK_EXTENSIONS)}>Go</Button>
        </div>
      </div>

      {results && (
        <>
          <p className="results-count"><strong>{results.length}</strong> rows returned</p>
          <DataTable rows={results} headers={HEADERS}>
            {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()} size="sm">
                  <TableHead><TableRow>{headers.map(h => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}</TableRow></TableHead>
                  <TableBody>
                    {rows.map(row => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map(cell => (
                          <TableCell key={cell.id}>
                            {cell.info.header === 'status'
                              ? <Tag type={cell.value === 'APP' ? 'green' : 'blue'} size="sm">{cell.value}</Tag>
                              : cell.value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </>
      )}
      <style>{`.search-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem 1.5rem; }`}</style>
    </PageLayout>
  );
}
