import {
  Column,
  DataTable,
  Grid,
  Loading,
  RadioButton,
  RadioButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import {ArrowLeft} from '@carbon/icons-react';
import {type FC, useEffect, useMemo, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import {useNotification} from '@/context/notification/useNotification';
import {type FspWorkflowEvent, getFspHistory} from '@/services/fspSearch';

import './FspInformation/fsp-info.scss';

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Amendment 0 is the original plan — render "Original" rather than "0".
const formatAmendment = (value: string | null | undefined): string => {
  if (value == null || value.trim() === '') return '—';
  return Number(value) === 0 ? 'Original' : value;
};

const HEADERS = [
  { key: 'amendmentNumber', header: 'Amnd #' },
  { key: 'extensionNumber', header: 'Ext #' },
  { key: 'eventDateTime', header: 'Event date / time' },
  { key: 'userId', header: 'User ID' },
  { key: 'approvalRequestIndicator', header: 'Appr rqd' },
  { key: 'event', header: 'Event' },
  { key: 'description', header: 'Description' },
];

type SortKey = 'EVENT' | 'AMEND';

const HistoryPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { display } = useNotification();
  const fspId = searchParams.get('fspId') ?? '';

  const [rows, setRows] = useState<FspWorkflowEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('EVENT');

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    getFspHistory(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (cancelled) return;
        display({
          kind: 'error',
          title: 'Unable to load history',
          subtitle: e instanceof Error ? e.message : 'Unknown error',
          timeout: 7000,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, display]);

  // Sort happens client-side so the user can toggle without re-fetching.
  // Numeric amendment field needs Number compare so "10" doesn't sort
  // before "2" lexically.
  const sortedRows = useMemo(() => {
    if (!rows) return [];
    const out = [...rows];
    if (sortKey === 'AMEND') {
      out.sort((a, b) => {
        const av = Number(a.amendmentNumber ?? 0);
        const bv = Number(b.amendmentNumber ?? 0);
        return av - bv;
      });
    } else {
      out.sort((a, b) => (a.eventDateTime ?? '').localeCompare(b.eventDateTime ?? ''));
    }
    return out;
  }, [rows, sortKey]);

  const tableRows = sortedRows.map((r, i) => ({
    id: `${r.eventDateTime ?? 'ev'}-${i}`,
    amendmentNumber: formatAmendment(r.amendmentNumber),
    extensionNumber: dash(r.extensionNumber),
    eventDateTime: dash(r.eventDateTime),
    userId: dash(r.userId),
    approvalRequestIndicator: r.approvalRequestIndicator === 'Y' ? 'Yes' : 'No',
    event: dash(r.event),
    description: dash(r.description),
  }));

  const backToFsp = () => {
    if (fspId) {
      navigate(`/fsp/information?fspId=${encodeURIComponent(fspId)}`);
    } else {
      navigate('/search');
    }
  };

  return (
    <Grid fullWidth className="default-grid fsp-info-grid">
      <Column sm={4} md={8} lg={16}>
        <button type="button" className="fsp-info__back" onClick={backToFsp}>
          <ArrowLeft size={16} /> Back to FSP {fspId}
        </button>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <header className="fsp-info__header">
          <div className="fsp-info__header-title">
            <h1>History — FSP {fspId || '—'}</h1>
          </div>
        </header>
      </Column>

      <Column sm={4} md={8} lg={16}>
        {!fspId ? (
          <p className="fsp-info__placeholder">No FSP selected.</p>
        ) : loading && !rows ? (
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading history…" withOverlay={false} />
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="fsp-info__placeholder">No history events recorded for this FSP.</p>
        ) : (
          <section className="fsp-info__tile fsp-info__tile--full">
            <header className="fsp-info__tile-header">
              <h2 className="fsp-info__section-title">Audit trail ({rows.length})</h2>
              <RadioButtonGroup
                legendText="Sort by"
                name="history-sort"
                valueSelected={sortKey}
                onChange={(v) => setSortKey(v as SortKey)}
                orientation="horizontal"
              >
                <RadioButton labelText="Event date" value="EVENT" id="sortEvent" />
                <RadioButton labelText="Amendment number" value="AMEND" id="sortAmend" />
              </RadioButtonGroup>
            </header>
            <div className="bordered-table">
              <DataTable rows={tableRows} headers={HEADERS} isSortable>
                {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="md" useZebraStyles>
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
                        {r.map((row) => (
                          <TableRow {...getRowProps({ row })} key={row.id}>
                            {row.cells.map((cell) => (
                              <TableCell key={cell.id}>{cell.value as string}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            </div>
          </section>
        )}
      </Column>
    </Grid>
  );
};

export default HistoryPage;
