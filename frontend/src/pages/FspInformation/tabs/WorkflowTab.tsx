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
} from '@carbon/react';
import {type FC, useEffect, useState} from 'react';

import {type FspWorkflowEvent, getFspWorkflow} from '@/services/fspSearch';

interface Props {
  fspId: string;
  /**
   * Parent-supplied monotonic counter. Bumped after any mutation
   * (Submit, Extend, …) so this tab re-fetches the History event log
   * — the proc appends a new SUBMIT/RET/etc. event server-side and
   * we'd otherwise show stale rows until the page is reloaded.
   */
  refreshKey?: number;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const HEADERS = [
  { key: 'eventDateTime', header: 'Date / time' },
  { key: 'event', header: 'Event' },
  { key: 'description', header: 'Description' },
  { key: 'userId', header: 'User' },
  { key: 'amendmentNumber', header: 'Amendment' },
  { key: 'extensionNumber', header: 'Extension' },
  { key: 'submissionId', header: 'Submission ID' },
];

const WorkflowTab: FC<Props> = ({ fspId, refreshKey }) => {
  const [rows, setRows] = useState<FspWorkflowEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspWorkflow(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Workflow load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, refreshKey]);

  if (loading && !rows) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading workflow…" withOverlay={false} />
      </div>
    );
  }
  if (error) return <p className="fsp-info__error">{error}</p>;
  if (!rows || rows.length === 0) {
    return <p className="fsp-info__placeholder">No workflow events recorded.</p>;
  }

  const tableRows = rows.map((r, i) => ({
    id: `${r.eventDateTime ?? 'ev'}-${i}`,
    eventDateTime: dash(r.eventDateTime),
    event: dash(r.event),
    description: dash(r.description),
    userId: dash(r.userId),
    amendmentNumber: dash(r.amendmentNumber),
    extensionNumber: dash(r.extensionNumber),
    submissionId: dash(r.submissionId),
  }));

  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <h2 className="fsp-info__section-title">History</h2>
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
  );
};

export default WorkflowTab;
