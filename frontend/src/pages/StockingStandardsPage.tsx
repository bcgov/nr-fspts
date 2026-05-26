import { useState } from 'react';
import { Button, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, Tag } from '@carbon/react';
import { Add, Search } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface StockingStandard {
  id: string;
  name: string;
  objective: string;
  amendNo: string;
  bgc: string;
  status: string;
  effectiveDate: string;
  default: string;
}

const MOCK_STANDARDS: StockingStandard[] = [
  { id: 'SS001', name: 'Interior Douglas-fir', objective: 'Free Growing', amendNo: '0', bgc: 'IDFdk3', status: 'Approved', effectiveDate: '2023-04-01', default: 'Y' },
  { id: 'SS002', name: 'Lodgepole Pine Std',   objective: 'Regeneration',  amendNo: '1', bgc: 'SBSmc2', status: 'Draft',    effectiveDate: '—',          default: 'N' },
  { id: 'SS003', name: 'Mixed Conifer',         objective: 'Free Growing', amendNo: '0', bgc: 'ESSFmc', status: 'Approved', effectiveDate: '2023-04-01', default: 'N' },
];

const HEADERS = [
  { key: 'id',            header: 'SS ID' },
  { key: 'name',          header: 'Standards Name' },
  { key: 'objective',     header: 'Objective' },
  { key: 'amendNo',       header: 'Amnd #' },
  { key: 'bgc',           header: 'BGC' },
  { key: 'status',        header: 'Status' },
  { key: 'effectiveDate', header: 'Effective Date' },
  { key: 'default',       header: 'Def.' },
];

export default function StockingStandardsPage() {
  const [rows] = useState<StockingStandard[]>(MOCK_STANDARDS);

  return (
    <PageLayout title="Stocking Standards">
      <FspTombstone fspId="10001" amendNo="1" status="Draft" />
      <FspTabStrip />

      <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0, marginBottom: '1rem' }}>
        <Button kind="primary"   renderIcon={Add}>Add New</Button>
        <Button kind="secondary" renderIcon={Search}>Search Standards</Button>
        <span className="results-count" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          <strong>{rows.length}</strong> rows returned
        </span>
      </div>

      <DataTable rows={rows} headers={HEADERS}>
        {({ rows: tableRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="sm">
              <TableHead><TableRow>{headers.map(h => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}</TableRow></TableHead>
              <TableBody>
                {tableRows.map(row => (
                  <TableRow {...getRowProps({ row })} key={row.id}>
                    {row.cells.map(cell => (
                      <TableCell key={cell.id}>
                        {cell.info.header === 'status'
                          ? <Tag type={cell.value === 'Approved' ? 'green' : 'gray'} size="sm">{cell.value}</Tag>
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
