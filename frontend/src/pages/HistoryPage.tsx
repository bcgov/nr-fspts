import { useState } from 'react';
import { RadioButton, RadioButtonGroup, Checkbox, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@carbon/react';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface HistoryRow {
  id: string;
  amendNo: string;
  extNo: string;
  eventDate: string;
  userId: string;
  approvalReqd: boolean;
  event: string;
  description: string;
  submissionId: string;
}

const MOCK_HISTORY: HistoryRow[] = [
  { id: '1', amendNo: '0', extNo: '—', eventDate: '2023-03-01 09:12', userId: 'jsmith',    approvalReqd: true,  event: 'Create',   description: 'FSP created',           submissionId: '' },
  { id: '2', amendNo: '0', extNo: '—', eventDate: '2023-03-15 14:30', userId: 'jsmith',    approvalReqd: true,  event: 'Submit',   description: 'FSP submitted for review', submissionId: 'SUB-0001' },
  { id: '3', amendNo: '0', extNo: '—', eventDate: '2023-04-01 10:00', userId: 'mbrown',    approvalReqd: true,  event: 'Approve',  description: 'Approved by DDM',       submissionId: '' },
  { id: '4', amendNo: '1', extNo: '—', eventDate: '2024-01-10 11:45', userId: 'jsmith',    approvalReqd: false, event: 'Create',   description: 'Amendment 1 created',   submissionId: '' },
];

const HEADERS = [
  { key: 'amendNo',      header: 'Amnd #' },
  { key: 'extNo',        header: 'Ext #' },
  { key: 'eventDate',    header: 'Event Date/Time' },
  { key: 'userId',       header: 'User ID' },
  { key: 'approvalReqd', header: 'Appr. Rqrd.' },
  { key: 'event',        header: 'Event' },
  { key: 'description',  header: 'Description' },
  { key: 'submissionId', header: 'Submission ID' },
];

export default function HistoryPage() {
  const [sortOrder, setSortOrder] = useState<string>('EVENT');

  return (
    <PageLayout title="History">
      <FspTombstone fspId="10001" amendNo="1" status="Draft" />
      <FspTabStrip />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <RadioButtonGroup legendText="Sort By" name="sortOrder" valueSelected={sortOrder} onChange={v => setSortOrder(v as string)} orientation="horizontal">
          <RadioButton labelText="Event Date" value="EVENT" id="sortEvent" />
          <RadioButton labelText="Amendment Number" value="AMEND" id="sortAmend" />
        </RadioButtonGroup>
        <span className="results-count"><strong>{MOCK_HISTORY.length}</strong> rows returned</span>
      </div>

      <DataTable rows={MOCK_HISTORY} headers={HEADERS}>
        {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="sm">
              <TableHead><TableRow>{headers.map(h => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}</TableRow></TableHead>
              <TableBody>
                {rows.map(row => (
                  <TableRow {...getRowProps({ row })} key={row.id}>
                    {row.cells.map(cell => (
                      <TableCell key={cell.id}>
                        {cell.info.header === 'approvalReqd'
                          ? <Checkbox id={`ar-${row.id}`} labelText="" hideLabel checked={cell.value} disabled />
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
    </PageLayout>
  );
}
