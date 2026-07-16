import {
  Button,
  DataTable,
  Loading,
  Pagination,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  Tile,
} from '@carbon/react';
import { CheckmarkFilled, Search as SearchIcon, SubtractAlt } from '@carbon/icons-react';
import {
  type FC,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { useNotification } from '@/context/notification/useNotification';
import { useOrg } from '@/context/org/useOrg';
import { safeErrorMessage } from '@/lib/errorMessage';
import {
  type CodeOption,
  type FspSearchResult,
  getFspStatusCodes,
  searchFsp,
} from '@/services/fspSearch';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import { formatDate } from '@/utils/formatDate';
import './SearchPage.scss';

// Same icon shim SearchPage uses — small Loading sized for a Button
// renderIcon slot. Shown in place of the magnifying glass while the
// request is in flight.
const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

interface SearchResult {
  id: string;
  fspId: string;
  amendNo: string;
  name: string;
  amendName: string;
  status: string;
  effectiveDate: string;
  expiryDate: string;
  submittedDate: string;
  approvalRequired: string;
}

const HEADERS = [
  { key: 'fspId', header: 'FSP ID' },
  { key: 'amendNo', header: 'Version' },
  { key: 'name', header: 'FSP name' },
  { key: 'amendName', header: 'Amendment name' },
  { key: 'status', header: 'Status' },
  { key: 'submittedDate', header: 'Submitted' },
  { key: 'effectiveDate', header: 'Effective date' },
  { key: 'expiryDate', header: 'Expiry date' },
  { key: 'approvalRequired', header: 'Approval required' },
];

const formatApprovalRequired = (value: string | null | undefined): string => {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return 'No';
  return '';
};

const mapToSearchResult = (r: FspSearchResult, index: number): SearchResult => ({
  id: r.fspId?.trim() ? `${r.fspId.trim()}-${index}` : `row-${index}`,
  fspId: r.fspId?.trim() ?? '',
  amendNo: r.fspAmendmentNumber ?? '',
  name: r.planName ?? '',
  amendName: r.fspAmendmentName ?? '',
  status: r.fspStatusDesc ?? '',
  effectiveDate: formatDate(r.planStartDate),
  expiryDate: formatDate(r.planEndDate),
  submittedDate: formatDate(r.planSubmissionDate),
  approvalRequired: formatApprovalRequired(r.amendmentApprovalRequirdInd),
});

interface SearchForm {
  fspId: string;
  status: string;
  fspName: string;
  amendName: string;
}

const EMPTY_FORM: SearchForm = {
  fspId: '',
  status: '',
  fspName: '',
  amendName: '',
};

// Versioned storage key — bump when SearchResult's shape changes so a
// stale persisted snapshot from before the schema change is discarded
// instead of silently rendering with missing fields.
const STORAGE_KEY = 'fsp.submission-history.state.v1';
const DEFAULT_PAGE_SIZE = 10;
const SORT_BY = 'planSubmissionDate';
const SORT_DIR: 'desc' = 'desc';

type PersistedSearchState = {
  form: SearchForm;
  results: SearchResult[] | null;
  totalElements: number;
  page: number;
  pageSize: number;
  orgClient: string | null;
};

const loadPersistedState = (): PersistedSearchState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSearchState>;
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null;
    return {
      form: { ...EMPTY_FORM, ...parsed.form },
      results: parsed.results ?? null,
      totalElements:
        typeof parsed.totalElements === 'number' ? parsed.totalElements : 0,
      page: typeof parsed.page === 'number' ? parsed.page : 0,
      pageSize:
        typeof parsed.pageSize === 'number' ? parsed.pageSize : DEFAULT_PAGE_SIZE,
      orgClient: typeof parsed.orgClient === 'string' ? parsed.orgClient : null,
    };
  } catch {
    return null;
  }
};

const formatCellText = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

/**
 * BCeID submitters' read-only audit of every FSP their active forest-client
 * organization is an agreement holder on. Reuses {@code searchFsp} with
 * {@code ahClientNumber} pinned to the active org — same scoping as
 * before — but now wraps the legacy auto-fire with the FSP-Search-style
 * form so users can filter by ID, status, name, amendment, approval,
 * and date range. The Organization Unit dropdown is intentionally
 * omitted: the org context is the logged-in user's active forest
 * client, not a free choice.
 */
const SubmissionHistoryPage: FC = () => {
  const navigate = useNavigate();
  const { activeOrgClientNumber } = useOrg();
  const { display } = useNotification();

  // Discard the persisted snapshot when the user switches active orgs.
  // Without this, the previous org's results would briefly paint
  // before the refetch lands — and worse, would show under the new
  // org's heading if the refetch errored.
  const persisted = (() => {
    const raw = loadPersistedState();
    if (!raw) return null;
    if (raw.orgClient && raw.orgClient !== (activeOrgClientNumber ?? null)) {
      return null;
    }
    return raw;
  })();

  const [form, setForm] = useState<SearchForm>(() => persisted?.form ?? EMPTY_FORM);
  const [results, setResults] = useState<SearchResult[] | null>(
    () => persisted?.results ?? null,
  );
  const [totalElements, setTotalElements] = useState<number>(
    persisted?.totalElements ?? 0,
  );
  const [page, setPage] = useState<number>(persisted?.page ?? 0);
  const [pageSize, setPageSize] = useState<number>(
    persisted?.pageSize ?? DEFAULT_PAGE_SIZE,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status dropdown is the only DB-backed code list this page needs
  // (no Organization Unit because we don't expose that filter). Loaded
  // once on mount; the page renders a spinner until it lands.
  const [statusOptions, setStatusOptions] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);

  useEffect(() => {
    if (error) {
      display({
        kind: 'error',
        title: 'Submission history failed',
        subtitle: error,
        timeout: 5000,
      });
    }
  }, [error, display]);

  useEffect(() => {
    let cancelled = false;
    setCodeListsLoading(true);
    getFspStatusCodes()
      .then((opts) => {
        if (!cancelled) setStatusOptions(opts);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(safeErrorMessage(e, 'Failed to load status codes.'));
        }
      })
      .finally(() => {
        if (!cancelled) setCodeListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          form,
          results,
          totalElements,
          page,
          pageSize,
          orgClient: activeOrgClientNumber ?? null,
        } satisfies PersistedSearchState),
      );
    } catch {
      // Quota / serialisation issue — non-fatal.
    }
  }, [form, results, totalElements, page, pageSize, activeOrgClientNumber]);

  const set = <K extends keyof SearchForm>(key: K, value: SearchForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Same digits-only sanitizer SearchPage uses for FSP ID. NUMBER(10)
  // on FOREST_STEWARDSHIP_PLAN.FSP_ID — strip anything else as the
  // user types so we don't waste a backend round-trip on validation.
  const setDigitsOnly = <K extends keyof SearchForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, e.target.value.replace(/\D/g, '') as SearchForm[K]);

  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      // BCeID without an active org → nothing to search yet. Show empty
      // rather than fire the proc with a blank client filter (which
      // would expose other orgs' data on the un-scoped result).
      if (!activeOrgClientNumber) {
        setResults([]);
        setTotalElements(0);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await searchFsp({
          fspId: form.fspId,
          fspPlanName: form.fspName,
          // ahClientNumber is force-pinned to the active org — the form
          // intentionally has no Agreement Holder field so the user
          // can't bypass the org scope.
          ahClientNumber: activeOrgClientNumber,
          fspAmendmentName: form.amendName,
          fspStatusCode: form.status,
          page: nextPage,
          size: nextSize,
          sortBy: SORT_BY,
          sortDir: SORT_DIR,
        });
        setResults(data.content.map(mapToSearchResult));
        setTotalElements(data.page.totalElements);
        setPage(data.page.number);
        setPageSize(data.page.size);
      } catch (e) {
        setError(safeErrorMessage(e));
        setResults([]);
        setTotalElements(0);
      } finally {
        setLoading(false);
      }
    },
    [form, activeOrgClientNumber],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void runSearch(0, pageSize);
    },
    [runSearch, pageSize],
  );

  const handlePagination = useCallback(
    ({ page: newPage, pageSize: newSize }: { page: number; pageSize: number }) => {
      void runSearch(newPage - 1, newSize);
    },
    [runSearch],
  );

  // Auto-fire on mount + whenever the active org changes. One-shot
  // ref prevents re-fires when runSearch's identity churns mid-mount
  // (form edits change the useCallback dep). The active-org-change
  // effect below resets the ref so the auto-fire re-runs after the
  // user picks a different org via the multi-org picker.
  const autoSearchFiredRef = useRef(false);
  useEffect(() => {
    if (autoSearchFiredRef.current) return;
    autoSearchFiredRef.current = true;
    void runSearch(persisted?.page ?? 0, persisted?.pageSize ?? DEFAULT_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSearch]);

  useEffect(() => {
    autoSearchFiredRef.current = false;
  }, [activeOrgClientNumber]);

  const handleClear = useCallback(() => {
    setForm(EMPTY_FORM);
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
  }, []);

  const hasResults = results !== null && results.length > 0;

  // Block the page render until the status code-list is loaded so the
  // dropdown doesn't flash empty / disabled values. Mirrors SearchPage.
  if (codeListsLoading) {
    return (
      <div className="fsp-search__loading" role="status" aria-live="polite">
        <Loading description="Loading…" withOverlay={false} />
      </div>
    );
  }

  return (
    <div className="fsp-search-page">
      <div className="fsp-search__header">
        <div>
          <h1>Submission History</h1>
          <p className="fsp-search__subtitle">
            Review every Forest Stewardship Plan your organization has
            submitted, across all amendments.
          </p>
        </div>
      </div>

      <Tile className="fsp-search__tile">
        <form className="fsp-search__form" onSubmit={handleSubmit}>
          <div className="fsp-search__field-grid">
            <TextInput
              id="submhist-fspId"
              labelText="FSP ID"
              value={form.fspId}
              onChange={setDigitsOnly('fspId')}
              maxLength={10}
              inputMode="numeric"
              autoComplete="off"
            />

            <Select
              id="submhist-status"
              labelText="Status"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              <SelectItem value="" text="All statuses" />
              {statusOptions.map((o) => (
                <SelectItem
                  key={o.code}
                  value={o.code}
                  text={o.description || o.code}
                />
              ))}
            </Select>

            <TextInput
              id="submhist-fspName"
              labelText="FSP name"
              value={form.fspName}
              onChange={(e) => set('fspName', e.target.value)}
              maxLength={120}
            />

            <TextInput
              id="submhist-amendName"
              labelText="Amendment name"
              value={form.amendName}
              onChange={(e) => set('amendName', e.target.value)}
              maxLength={30}
            />
          </div>

          <div className="fsp-search__actions">
            <Button
              kind="tertiary"
              size="md"
              type="button"
              onClick={handleClear}
              disabled={loading}
            >
              Clear
            </Button>
            <Button
              type="submit"
              size="md"
              disabled={loading || !activeOrgClientNumber}
              renderIcon={loading ? SearchingIcon : SearchIcon}
            >
              {loading ? 'Searching...' : 'Search'}
            </Button>
          </div>
        </form>
      </Tile>

      {results !== null && (
        <div className="fsp-search__results-fullbleed">
          <div className="fsp-search__results">
            {hasResults && (
              <>
                <div className="fsp-search__results-header">
                  <span className="fsp-search__results-count">
                    {totalElements.toLocaleString()}{' '}
                    {totalElements === 1 ? 'submission' : 'submissions'} found
                  </span>
                </div>
                <div className="fsp-search__table-container">
                  <div className={loading ? 'fsp-search__table--loading' : undefined}>
                    <div className="fsp-search__table">
                      <DataTable rows={results!} headers={HEADERS}>
                        {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                          <TableContainer>
                            <Table {...getTableProps()} size="md">
                              <TableHead>
                                <TableRow>
                                  {headers.map((h) => (
                                    <TableHeader
                                      {...getHeaderProps({ header: h })}
                                      key={h.key}
                                    >
                                      {h.header}
                                    </TableHeader>
                                  ))}
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {rows.map((row) => {
                                  const fspIdRaw =
                                    (row.cells.find((c) => c.info.header === 'fspId')
                                      ?.value as string | undefined) ?? '';
                                  const amendmentNumber =
                                    (row.cells.find((c) => c.info.header === 'amendNo')
                                      ?.value as string | undefined) ?? '';
                                  const goToFsp = () => {
                                    if (!fspIdRaw) return;
                                    const params = new URLSearchParams({ fspId: fspIdRaw });
                                    if (amendmentNumber)
                                      params.set('amendmentNumber', amendmentNumber);
                                    navigate(`/fsp/information?${params.toString()}`);
                                  };
                                  return (
                                    <TableRow
                                      {...getRowProps({ row })}
                                      key={row.id}
                                      className="fsp-search__row--selectable"
                                      onClick={goToFsp}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          goToFsp();
                                        }
                                      }}
                                      tabIndex={0}
                                      role="link"
                                    >
                                      {row.cells.map((cell) => {
                                        const value = cell.value as string | null | undefined;
                                        if (cell.info.header === 'status' && value) {
                                          return (
                                            <TableCell key={cell.id}>
                                              <StatusTag status={value} />
                                            </TableCell>
                                          );
                                        }
                                        // Amendment 0 is the original plan — display
                                        // "Original" but keep the raw "0" value
                                        // (the nav URL reads it from the cell value).
                                        if (cell.info.header === 'amendNo') {
                                          return (
                                            <TableCell key={cell.id}>
                                              {value === '0'
                                                ? 'Original'
                                                : formatCellText(value as string)}
                                            </TableCell>
                                          );
                                        }
                                        // Approval required → check / minus icon,
                                        // same treatment as FSP Search.
                                        if (cell.info.header === 'approvalRequired') {
                                          if (value === 'Yes') {
                                            return (
                                              <TableCell key={cell.id}>
                                                <span className="fsp-search__bool fsp-search__bool--yes">
                                                  <CheckmarkFilled size={16} />
                                                  Yes
                                                </span>
                                              </TableCell>
                                            );
                                          }
                                          if (value === 'No') {
                                            return (
                                              <TableCell key={cell.id}>
                                                <span className="fsp-search__bool fsp-search__bool--no">
                                                  <SubtractAlt size={16} />
                                                  No
                                                </span>
                                              </TableCell>
                                            );
                                          }
                                        }
                                        return (
                                          <TableCell key={cell.id}>
                                            {formatCellText(value as string)}
                                          </TableCell>
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
                  </div>
                  {loading && (
                    <div
                      className="fsp-search__table-overlay"
                      role="status"
                      aria-live="polite"
                    >
                      <Loading description="Loading…" withOverlay={false} />
                    </div>
                  )}
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

            {!hasResults &&
              results !== null &&
              !error &&
              (activeOrgClientNumber ? (
                <EmptyState
                  title="No results found"
                  body={
                    <>
                      No submissions match your search criteria.
                      <br />
                      Try adjusting your filters and searching again.
                    </>
                  }
                />
              ) : (
                <EmptyState
                  title="Select an organization"
                  body="Choose an active organization to see its submission history."
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubmissionHistoryPage;
