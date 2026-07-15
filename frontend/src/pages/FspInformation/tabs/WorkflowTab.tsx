import {
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import {CheckmarkFilled, SubtractFilled} from '@carbon/icons-react';
import {type FC, useEffect, useMemo, useState} from 'react';

import {type FspWorkflowEvent, getFspWorkflow} from '@/services/fspSearch';

type SortDir = 'ASC' | 'DESC';
// Which column drives the sort. Date is the default (newest-first).
type SortKey =
  | 'date'
  | 'event'
  | 'description'
  | 'approval'
  | 'userId'
  | 'amendment'
  | 'extension';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// The proc returns event_date_time as "YYYY-MM-DD HH:MM:SS AM/PM"
// (e.g. "2026-07-07 03:28:50 PM"). Capture the parts once so we can both
// reformat for display and derive a sortable timestamp.
const EVENT_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i;

// Sortable epoch (UTC ms) from the raw string. 0 for unparseable rows,
// which keeps them in their original relative order.
const parseEventTime = (value: string | null): number => {
  if (!value) return 0;
  const m = EVENT_DATE_TIME.exec(value.trim());
  if (!m) return 0;
  let hour = Number(m[4]);
  const meridiem = m[7].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[5]), Number(m[6]));
};

// Per-column sort value. Numbers sort numerically (dates via epoch,
// amendment/extension as integers); everything else compares as
// lower-cased text so the order is case-insensitive.
const SORT_ACCESSORS: Record<SortKey, (r: FspWorkflowEvent) => number | string> = {
  date: (r) => parseEventTime(r.eventDateTime),
  event: (r) => (r.event ?? '').toLowerCase(),
  description: (r) => (r.description ?? '').toLowerCase(),
  approval: (r) => (r.approvalRequestIndicator ?? '').toLowerCase(),
  userId: (r) => (r.userId ?? '').toLowerCase(),
  amendment: (r) => Number(r.amendmentNumber ?? 0) || 0,
  extension: (r) => Number(r.extensionNumber ?? 0) || 0,
};

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

// Amendment 0 is the original plan — render "Original" rather than "0".
const formatAmendment = (value: string | null | undefined): string => {
  if (value == null || value.trim() === '') return '—';
  return Number(value) === 0 ? 'Original' : value;
};

// Reformat "2026-07-07 03:28:50 PM" → "Jul 07, 2026 - 03:28:50 PM".
// Unparseable values pass through unchanged (after the empty-value dash).
const formatEventDateTime = (value: string | null): string => {
  const v = dash(value);
  if (v === '—') return v;
  const m = EVENT_DATE_TIME.exec(v.trim());
  if (!m) return v;
  return `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]} - ${m[4]}:${m[5]}:${m[6]} ${m[7].toUpperCase()}`;
};

// "Approval required?" cell — green checkmark + Yes when the event's
// approval-request indicator is 'Y', a muted minus + No when 'N', em-dash
// when unknown.
const ApprovalRequired: FC<{ value: string }> = ({ value }) => {
  if (value === 'Y') {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
      >
        <CheckmarkFilled
          size={16}
          style={{ fill: 'var(--cds-support-success)' }}
        />
        Yes
      </span>
    );
  }
  if (value === 'N') {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
      >
        <SubtractFilled
          size={16}
          style={{ fill: 'var(--cds-icon-secondary)' }}
        />
        No
      </span>
    );
  }
  return <span>—</span>;
};

const WorkflowTab: FC<Props> = ({ fspId, refreshKey }) => {
  const [rows, setRows] = useState<FspWorkflowEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default to newest-first, with the sort indicator shown on the Date
  // column; clicking any header sorts by that column (toggling the
  // direction when the same header is clicked again).
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('DESC');

  // Clicking a header sorts by that column. Re-clicking the active header
  // flips the direction; switching columns starts from a sensible default
  // (Date newest-first, everything else A→Z / low→high).
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'DESC' ? 'ASC' : 'DESC'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' ? 'DESC' : 'ASC');
    }
  };

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

  // Frontend sort keyed on the active column. Dates compare via a parsed
  // timestamp so months order chronologically (a plain string sort would
  // put "Jul" before "Jun"); text columns compare case-insensitively.
  // Stable within equal values.
  const sorted = useMemo(() => {
    if (!rows) return [];
    const accessor = SORT_ACCESSORS[sortKey];
    const dir = sortDir === 'ASC' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      let diff: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        diff = av - bv;
      } else {
        diff = String(av).localeCompare(String(bv));
      }
      return diff * dir;
    });
  }, [rows, sortKey, sortDir]);

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

  // Icon-titled section heading (matching Plan details) above the History
  // table. Sorting is handled manually (above) so we render a static Carbon
  // table and drive each column's sort indicator from `sortKey`/`sortDir`.
  const headerProps = (key: SortKey) => ({
    isSortable: true,
    isSortHeader: sortKey === key,
    sortDirection: (sortKey === key ? sortDir : 'NONE') as SortDir | 'NONE',
    onClick: () => toggleSort(key),
  });

  return (
    <>
      <div className="bordered-table">
      <TableContainer>
        <Table size="md" useZebraStyles>
          <TableHead>
            <TableRow>
              <TableHeader {...headerProps('date')}>Date and time</TableHeader>
              <TableHeader {...headerProps('event')}>Event</TableHeader>
              <TableHeader {...headerProps('description')}>Description</TableHeader>
              <TableHeader {...headerProps('approval')}>Approval required</TableHeader>
              <TableHeader {...headerProps('userId')}>User ID</TableHeader>
              <TableHeader {...headerProps('amendment')}>Amendment</TableHeader>
              <TableHeader {...headerProps('extension')}>Extension</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r, i) => (
              <TableRow key={`${r.eventDateTime ?? 'ev'}-${i}`}>
                <TableCell>{formatEventDateTime(r.eventDateTime)}</TableCell>
                <TableCell>{dash(r.event)}</TableCell>
                <TableCell>{dash(r.description)}</TableCell>
                <TableCell>
                  <ApprovalRequired value={r.approvalRequestIndicator ?? ''} />
                </TableCell>
                <TableCell>{dash(r.userId)}</TableCell>
                <TableCell>{formatAmendment(r.amendmentNumber)}</TableCell>
                <TableCell>{dash(r.extensionNumber)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      </div>
    </>
  );
};

export default WorkflowTab;
