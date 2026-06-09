import {
  Column,
  DataTable,
  Grid,
  Loading,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { useCallback, useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useOrg } from '@/context/org/useOrg';
import { searchFsp, type FspSearchResult } from '@/services/fspSearch';

// Share the Data Submission page's header styling (.default-grid +
// .fsp-submit__header) so the two BCeID-facing pages have an identical
// top-of-page treatment. The sheet's other classes are scoped to
// elements only XmlSubmissionPage renders, so no collision risk.
import './XmlSubmissionPage.scss';

type TagType = 'green' | 'blue' | 'gray' | 'red' | 'warm-gray';

const STATUS_TAG_TYPE_BY_DESC: Record<string, TagType> = {
  Approved: 'green',
  Effective: 'green',
  Rejected: 'red',
  Submitted: 'blue',
  Draft: 'gray',
  'Clarification Requested': 'gray',
  'Opportunity to be Heard': 'warm-gray',
  Expired: 'warm-gray',
  Cancelled: 'warm-gray',
  Retired: 'warm-gray',
};

const dash = (v: string | null | undefined): string =>
  v && v.trim() ? v : '—';

const statusTag = (desc: string | null | undefined): ReactNode => {
  if (!desc || !desc.trim()) return <span>—</span>;
  const type = STATUS_TAG_TYPE_BY_DESC[desc.trim()] ?? 'gray';
  return (
    <Tag type={type} size="sm">
      {desc.trim()}
    </Tag>
  );
};

const HEADERS = [
  { key: 'fspId', header: 'FSP ID' },
  { key: 'planName', header: 'Plan Name' },
  { key: 'amendmentName', header: 'Amendment' },
  { key: 'orgUnit', header: 'District' },
  { key: 'submitted', header: 'Submitted' },
  { key: 'effective', header: 'Effective' },
  { key: 'expiry', header: 'Expiry' },
  { key: 'status', header: 'Status' },
];

interface Row {
  id: string;
  fspId: string;
  planName: string;
  amendmentName: string;
  orgUnit: string;
  submitted: string;
  effective: string;
  expiry: string;
  status: ReactNode;
  /** Original FSP id used to build the open-row click URL — kept off the table cell render. */
  __href: string | null;
}

/**
 * BCeID submitters' read-only audit of every FSP their active forest-client
 * organization is an agreement holder on. Reuses {@code searchFsp} (which
 * the FSP Search page already drives) with {@code ahClientNumber} pinned
 * to the active org — no new backend endpoint needed. When the user
 * switches active orgs via the picker the page auto-reloads with the new
 * scope.
 *
 * <p>This is the BCeID-only counterpart to the IDIR Inbox / FSP Search
 * combo. IDIR users don't need it (they have those richer tools); the
 * SideNav entry is hidden for them via {@link getMenuEntries}.
 */
const SubmissionHistoryPage: FC = () => {
  const navigate = useNavigate();
  const { activeOrgClientNumber } = useOrg();
  const [results, setResults] = useState<FspSearchResult[] | null>(null);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number, nextSize: number) => {
      if (!activeOrgClientNumber) {
        setResults([]);
        setTotalElements(0);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await searchFsp({
          ahClientNumber: activeOrgClientNumber,
          page: nextPage,
          size: nextSize,
          sortBy: 'planSubmissionDate',
          sortDir: 'desc',
        });
        setResults(data.content);
        setTotalElements(data.page.totalElements);
        setPage(data.page.number);
        setPageSize(data.page.size);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
        setTotalElements(0);
      } finally {
        setLoading(false);
      }
    },
    [activeOrgClientNumber],
  );

  // Re-fetch on first load and whenever the active org changes (the
  // picker writes through sessionStorage and OrgContext, so the
  // dependency just works).
  useEffect(() => {
    void load(0, pageSize);
    // pageSize intentionally not in deps — page-size changes are
    // handled through handlePagination so we keep one request per
    // user gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const handlePagination = ({
    page: newPage,
    pageSize: newSize,
  }: {
    page: number;
    pageSize: number;
  }) => {
    void load(newPage - 1, newSize);
  };

  const rows: Row[] = useMemo(() => {
    return (results ?? []).map((r, i) => ({
      id: `${r.fspId ?? ''}-${r.fspAmendmentNumber ?? i}`,
      fspId: dash(r.fspId),
      planName: dash(r.planName),
      amendmentName: dash(r.fspAmendmentName),
      orgUnit: dash(r.orgUnitCode),
      submitted: dash(r.planSubmissionDate),
      effective: dash(r.planStartDate),
      expiry: dash(r.planEndDate),
      status: statusTag(r.fspStatusDesc),
      __href: r.fspId
        ? `/fsp/information?fspId=${encodeURIComponent(r.fspId)}` +
          (r.fspAmendmentNumber
            ? `&amendmentNumber=${encodeURIComponent(r.fspAmendmentNumber)}`
            : '')
        : null,
    }));
  }, [results]);

  return (
    <Grid fullWidth className="default-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-submit__header">
          <h1>Submission History</h1>
        </div>
      </Column>
      <Column lg={16} md={8} sm={4}>

        {error && (
          <div
            role="alert"
            style={{
              background: '#fff1f1',
              border: '1px solid #da1e28',
              padding: '8px 12px',
              borderRadius: 4,
              color: '#a2191f',
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}

        {loading && !results && (
          <div
            role="status"
            aria-live="polite"
            // Center the spinner in the remaining viewport (everything
            // below the page header), both horizontally and vertically.
            // 60vh is enough to push it well clear of the title without
            // pinning to the very middle of the OS window — looks right
            // at desktop and tablet widths.
            style={{
              minHeight: '60vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Loading description="Loading submissions…" withOverlay={false} />
          </div>
        )}

        {results && results.length === 0 && !loading && (
          <div
            // Same centering treatment as the loading spinner so the
            // empty state lands in the same visual spot rather than
            // hugging the top of the page.
            style={{
              minHeight: '60vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#525252',
            }}
          >
            <p>No submissions found for this organization.</p>
          </div>
        )}

        {results && results.length > 0 && (
          <>
            <div className="bordered-table">
              <DataTable rows={rows} headers={HEADERS}>
                {({ rows: tRows, headers, getTableProps, getHeaderProps, getRowProps }) => (
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
                        {tRows.map((row, i) => {
                          // Pull the original row's URL back from the
                          // memoised rows array — DataTable's `cells`
                          // only carries the rendered columns, but the
                          // click target lives in __href which we
                          // intentionally kept off the headers.
                          const href = rows[i]?.__href ?? null;
                          const clickable = !!href;
                          return (
                            <TableRow
                              {...getRowProps({ row })}
                              key={row.id}
                              onClick={
                                clickable ? () => navigate(href) : undefined
                              }
                              // Spacebar / Enter on a focused row also navigates,
                              // matching the keyboard expectation for a row that
                              // visually acts like a link.
                              onKeyDown={
                                clickable
                                  ? (e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        navigate(href);
                                      }
                                    }
                                  : undefined
                              }
                              tabIndex={clickable ? 0 : -1}
                              style={
                                clickable ? { cursor: 'pointer' } : undefined
                              }
                            >
                              {row.cells.map((cell) => (
                                <TableCell key={cell.id}>
                                  {cell.value as ReactNode}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            </div>
            <Pagination
              page={page + 1}
              pageSize={pageSize}
              pageSizes={[10, 25, 50, 100]}
              totalItems={totalElements}
              onChange={handlePagination}
              size="md"
            />
          </>
        )}
      </Column>
    </Grid>
  );
};

export default SubmissionHistoryPage;
