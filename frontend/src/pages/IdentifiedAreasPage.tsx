import { Button, DataTable, TableContainer, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, Tabs, Tab, TabList, TabPanels, TabPanel } from '@carbon/react';
import { Map } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import { FspTombstone, FspTabStrip } from './FspShared';
import './PageLayout.css';

interface AreaRow {
  id: string;
  name: string;
  type: string;
}

const MOCK_FRPA: AreaRow[] = [
  { id: 'IA001', name: 'Riparian Management Area – South Creek',    type: 'FRPA 196(1)' },
  { id: 'IA002', name: 'Wildlife Habitat Area – Spotted Owl Zone',  type: 'FRPA 196(1)' },
];

const MOCK_FPPR: AreaRow[] = [
  { id: 'IA003', name: 'Old Growth Management Area – Block 12',     type: 'FPPR' },
];

const HEADERS = [
  { key: 'name', header: 'Identified Area Name' },
  { key: 'type', header: 'Type' },
];

function AreaTable({ rows }: { rows: AreaRow[] }) {
  return (
    <DataTable rows={rows} headers={HEADERS}>
      {({ rows: tableRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="sm">
            <TableHead><TableRow>
              {headers.map(h => <TableHeader {...getHeaderProps({ header: h })} key={h.key}>{h.header}</TableHeader>)}
              <TableHeader key="map"></TableHeader>
            </TableRow></TableHead>
            <TableBody>
              {tableRows.map(row => (
                <TableRow {...getRowProps({ row })} key={row.id}>
                  {row.cells.map(cell => <TableCell key={cell.id}>{cell.value}</TableCell>)}
                  <TableCell><Button kind="ghost" size="sm" renderIcon={Map}>Map View</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  );
}

export default function IdentifiedAreasPage() {
  return (
    <PageLayout title="Identified Areas / Map">
      <FspTombstone fspId="10001" amendNo="1" status="Draft" />
      <FspTabStrip />

      <Tabs>
        <TabList aria-label="Identified area types">
          <Tab>FRPA Section 196(1)</Tab>
          <Tab>FPPR</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>FRPA Section 196(1) Areas</h3>
            <AreaTable rows={MOCK_FRPA} />
          </TabPanel>
          <TabPanel>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>FPPR Areas</h3>
            <AreaTable rows={MOCK_FPPR} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </PageLayout>
  );
}
