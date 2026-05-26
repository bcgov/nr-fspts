import { useState } from 'react';
import { RadioButton, RadioButtonGroup, Button, FileUploader, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@carbon/react';
import { View, TrashCan } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

const MOCK_DOCS = [
  { id: '1', source: 'Amnd 0', cons: 'Y', description: 'FSP Legal Document', fileName: 'FSP_10001_Legal.pdf',   fileSize: '1.2 MB' },
  { id: '2', source: 'Amnd 1', cons: 'N', description: 'Stocking Standards',  fileName: 'StockingStds_v2.pdf', fileSize: '340 KB' },
];

const HEADERS = [
  { key: 'source',      header: 'Source' },
  { key: 'cons',        header: 'Cons' },
  { key: 'description', header: 'Description' },
  { key: 'fileName',    header: 'File Name' },
  { key: 'fileSize',    header: 'File Size' },
];

export default function AttachmentsPage() {
  const [display, setDisplay] = useState<string>('N');

  return (
    <PageLayout title="Attachments">
      <FspTombstone fspId="10001" amendNo="1" status="Draft" />
      <FspTabStrip />

      <div className="form-section">
        <RadioButtonGroup legendText="Display" name="display" valueSelected={display} onChange={v => setDisplay(v as string)} orientation="horizontal">
          <RadioButton labelText="Amendment 1" value="N" id="dispN" />
          <RadioButton labelText="All Current and In Effect/Approved Attachments (view only)" value="Y" id="dispY" />
        </RadioButtonGroup>
      </div>

      {/* FSP Legal Document section */}
      <div className="form-section">
        <div className="form-section__title">FSP Legal Document</div>
        {display === 'N' && (
          <div style={{ marginBottom: '1rem' }}>
            <FileUploader labelTitle="Upload new document" labelDescription="PDF only. Max 10 MB." buttonLabel="Add file" accept={['.pdf']} filenameStatus="edit" />
          </div>
        )}
        <DataTable rows={MOCK_DOCS} headers={HEADERS}>
          {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
            <TableContainer>
              <Table {...getTableProps()} size="sm">
                <TableHead><TableRow>{headers.map(h => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}<TableHeader key="actions"></TableHeader></TableRow></TableHead>
                <TableBody>
                  {rows.map(row => (
                    <TableRow {...getRowProps({ row })} key={row.id}>
                      {row.cells.map(cell => <TableCell key={cell.id}>{cell.value}</TableCell>)}
                      <TableCell>
                        <Button kind="ghost" size="sm" renderIcon={View} iconDescription="View" hasIconOnly />
                        {display === 'N' && <Button kind="danger--ghost" size="sm" renderIcon={TrashCan} iconDescription="Delete" hasIconOnly />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      </div>
    </PageLayout>
  );
}
