import {
  DataTable,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectRow,
  Tag,
} from '@carbon/react';
import {Checkmark} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

import {type FspStandardRow, getFspStandards} from '@/services/fspSearch';

import StandardRegimeDetailPanel from './StandardRegimeDetailPanel';

interface Props {
  fspId: string;
  /**
   * The FSP's resolved amendment number — needed so the detail proc
   * scopes its FSP-specific org-unit / agreement-holder cursors to
   * the right amendment. Empty is fine; the proc handles it.
   */
  amendmentNumber: string;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Column order mirrors the legacy Stocking Standards screen:
// (radio) | SS ID | Standards Name | Objective | Amnd # | BGC | Status | Effective | Def.
// `select` is a virtual header to reserve the leading TableSelectRow column.
const HEADERS = [
  { key: 'select', header: '' },
  { key: 'standardsRegimeId', header: 'Standards ID' },
  { key: 'standardsRegimeName', header: 'Standards Name' },
  { key: 'standardsObjective', header: 'Objective' },
  { key: 'standardsAmndNumber', header: 'Amendment Number' },
  { key: 'standardsBgc', header: 'BGC' },
  { key: 'standardsRegimeStatus', header: 'Status' },
  { key: 'standardsEffectiveDate', header: 'Effective Date' },
  { key: 'defaultStandard', header: 'Def.' },
];

// Carbon Tag colour by status, matching the FSP search palette so a user
// crossing between screens reads the badges consistently.
const STATUS_TAG: Record<string, 'green' | 'blue' | 'gray' | 'red' | 'warm-gray'> = {
  Approved: 'green',
  Submitted: 'blue',
  Draft: 'gray',
  Rejected: 'red',
  Expired: 'warm-gray',
};

const StockingStandardsTab: FC<Props> = ({ fspId, amendmentNumber }) => {
  const [rows, setRows] = useState<FspStandardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drives the FSP250 detail panel below the table. null = nothing
  // picked yet; setting it back to null collapses the panel.
  const [selectedRegimeId, setSelectedRegimeId] = useState<string | null>(null);

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspStandards(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Standards load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId]);

  // Drop any stale selection when the underlying list reloads (e.g.
  // user switched FSP). Without this, the detail panel would chase a
  // regime that may no longer be in the visible set.
  useEffect(() => {
    if (selectedRegimeId && rows && !rows.some((r) => r.standardsRegimeId === selectedRegimeId)) {
      setSelectedRegimeId(null);
    }
  }, [rows, selectedRegimeId]);

  if (loading && !rows) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading standards…" withOverlay={false} />
      </div>
    );
  }
  if (error) return <p className="fsp-info__error">{error}</p>;
  if (!rows || rows.length === 0) {
    return (
      <p className="fsp-info__placeholder">No stocking standards on this FSP.</p>
    );
  }

  const tableRows = rows.map((r, i) => ({
    id: r.standardsRegimeId ?? `row-${i}`,
    standardsRegimeId: dash(r.standardsRegimeId),
    standardsRegimeName: dash(r.standardsRegimeName),
    standardsObjective: dash(r.standardsObjective),
    standardsAmndNumber: dash(r.standardsAmndNumber),
    standardsBgc: dash(r.standardsBgc),
    standardsRegimeStatus: dash(r.standardsRegimeStatus),
    standardsEffectiveDate: dash(r.standardsEffectiveDate),
    // Carbon DataTable can't render JSX from this map, so store the raw
    // Y/N here and switch in the cell renderer below.
    defaultStandard: r.defaultStandardInd === 'Y' ? 'Y' : '',
    __regimeId: r.standardsRegimeId,
  }));

  return (
    <>
      <section className="fsp-info__tile fsp-info__tile--full">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">Stocking Standards</h2>
        </header>
        <div className="bordered-table">
          <DataTable rows={tableRows} headers={HEADERS}>
            {({ rows: r, headers, getTableProps, getHeaderProps }) => (
              <TableContainer>
                <Table {...getTableProps()} size="md">
                  <TableHead>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHeader {...getHeaderProps({ header: h })} key={h.key}>
                          {h.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {r.map((row) => {
                      // Look up the raw regime id from the source row by
                      // matching row.id (which is the regime id itself
                      // unless the source row was missing it).
                      const source = tableRows.find((s) => s.id === row.id);
                      const regimeId = source?.__regimeId ?? null;
                      const isSelected =
                        regimeId !== null && regimeId === selectedRegimeId;
                      const pick = () => {
                        if (regimeId) setSelectedRegimeId(regimeId);
                      };
                      return (
                        <TableRow
                          key={row.id}
                          className={`fsp-info__row${
                            isSelected ? ' fsp-info__row--selected' : ''
                          }`}
                          onClick={pick}
                        >
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'select') {
                              return (
                                <TableSelectRow
                                  key={cell.id}
                                  radio
                                  id={`ss-select-${row.id}`}
                                  name="ss-selection"
                                  ariaLabel={`Select standards regime ${row.id}`}
                                  checked={isSelected}
                                  onSelect={pick}
                                />
                              );
                            }
                            if (
                              cell.info.header === 'standardsRegimeStatus' &&
                              cell.value
                            ) {
                              const status = cell.value as string;
                              return (
                                <TableCell key={cell.id}>
                                  <Tag type={STATUS_TAG[status] ?? 'gray'} size="sm">
                                    {status}
                                  </Tag>
                                </TableCell>
                              );
                            }
                            if (cell.info.header === 'defaultStandard') {
                              return (
                                <TableCell key={cell.id}>
                                  {cell.value === 'Y' ? (
                                    <Checkmark
                                      size={16}
                                      aria-label="Default standard"
                                    />
                                  ) : null}
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={cell.id}>{cell.value as string}</TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </div>
      </section>

      {selectedRegimeId && (
        <StandardRegimeDetailPanel
          fspId={fspId}
          amendmentNumber={amendmentNumber}
          regimeId={selectedRegimeId}
        />
      )}
    </>
  );
};

export default StockingStandardsTab;
