import {
  Button,
  Column,
  DataTable,
  DatePicker,
  DatePickerInput,
  Grid,
  Loading,
  Pagination,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react';
import {Search as SearchIcon} from '@carbon/icons-react';
import {type FC, type FormEvent, useCallback, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';

import ClientSearchModal from '@/components/ClientSearchModal';
import {useNotification} from '@/context/notification/useNotification';
import {type CodeOption, type FspSearchResult, getFspStatusCodes, getOrgUnits, searchFsp,} from '@/services/fspSearch';
import './SearchPage.scss';

// Renders Carbon's small inline spinner sized to fit inside a Button's
// icon slot. Used as the `renderIcon` of the Search button while a
// request is in flight so the spinner sits where the magnifying-glass
// icon normally is. withOverlay={false} prevents Loading from dimming
// the whole page (its default behaviour).
const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

// Date Type and Approval Required were hardcoded in the legacy JSP too —
// they're not driven by a code table, just static option lists, so they
// stay literal here. Organization Unit and Status come from code-list
// endpoints (loaded once on mount, see useEffect below).
const DATE_TYPE_OPTIONS = [
  { value: 'INITIATION', label: 'Initiation' },
  { value: 'DECISION', label: 'Decision' },
  { value: 'EFFECTIVE', label: 'Effective' },
  { value: 'EXPIRY', label: 'Expiry' },
  { value: 'SUBMITTED', label: 'Submitted' },
];

const APPROVAL_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'Y', label: 'Yes' },
  { value: 'N', label: 'No' },
];

interface SearchResult {
  id: string;
  amendNo: string;
  name: string;
  amendName: string;
  status: string;
  orgUnit: string;
  effectiveDate: string;
  expiryDate: string;
  holder: string;
  approvalRequired: string;
}

const HEADERS = [
  { key: 'id', header: 'FSP ID' },
  { key: 'amendNo', header: 'Amendment #' },
  { key: 'name', header: 'FSP Name' },
  { key: 'amendName', header: 'Amendment Name' },
  { key: 'status', header: 'Status' },
  { key: 'orgUnit', header: 'Org Unit' },
  { key: 'effectiveDate', header: 'Effective Date' },
  { key: 'expiryDate', header: 'Expiry Date' },
  { key: 'holder', header: 'Agreement Holder' },
  { key: 'approvalRequired', header: 'Approval Required' },
];

// Carbon Tag color by FSP status description as returned in fspStatusDesc.
// Backend's FSP_100_SEARCH cursor returns the status as a human label
// (e.g. "Approved"), not the code, so we key by description. Unknown
// values fall back to gray via the lookup default.
const STATUS_TAG_TYPE_BY_DESC: Record<string, 'green' | 'blue' | 'gray' | 'red' | 'warm-gray'> = {
  Approved: 'green',
  Submitted: 'blue',
  Draft: 'gray',
  Rejected: 'red',
  Expired: 'warm-gray',
};

// Y/N indicator → readable cell text. Anything else (null, empty, unexpected
// value) falls through to the em-dash placeholder via formatCellText.
const formatApprovalRequired = (value: string | null | undefined): string => {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return 'No';
  return '';
};

const mapToSearchResult = (r: FspSearchResult, index: number): SearchResult => ({
  // DataTable requires a unique id per row. Within one page of results
  // fspId is unique, but if the user pages backward and forward we
  // could collide across pages — disambiguate with the absolute row
  // index inside the current page.
  id: r.fspId?.trim() ? `${r.fspId.trim()}-${index}` : `row-${index}`,
  amendNo: r.fspAmendmentNumber ?? '',
  name: r.planName ?? '',
  amendName: r.fspAmendmentName ?? '',
  status: r.fspStatusDesc ?? '',
  orgUnit: r.orgUnitCode ?? '',
  effectiveDate: r.planStartDate ?? '',
  expiryDate: r.planEndDate ?? '',
  holder: r.agreementHolder ?? '',
  approvalRequired: formatApprovalRequired(r.amendmentApprovalRequirdInd),
});

interface SearchForm {
  orgUnit: string;
  fspId: string;
  status: string;
  fspName: string;
  amendName: string;
  dateType: string;
  dateFrom: string;
  dateTo: string;
  holder: string;
  approval: string;
}

const EMPTY_FORM: SearchForm = {
  orgUnit: '',
  fspId: '',
  status: '',
  fspName: '',
  amendName: '',
  dateType: 'INITIATION',
  dateFrom: '',
  dateTo: '',
  holder: '',
  approval: '',
};

// Same persistence pattern as REPT's ProjectSearchPage: round-trip form +
// last-executed search through sessionStorage so navigating away and back
// preserves both the inputs, the result page, and the user's pagination
// position. Sort key/direction aren't user-toggleable yet (always
// fspId desc) so they're not persisted; if column-header sorting lands
// later, add them here.
const STORAGE_KEY = 'fsp.search.state';

type PersistedSearchState = {
  form: SearchForm;
  results: SearchResult[] | null;
  totalElements: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 10;
const SORT_BY = 'fspId';
const SORT_DIR: 'asc' | 'desc' = 'desc';

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
      totalElements: typeof parsed.totalElements === 'number' ? parsed.totalElements : 0,
      page: typeof parsed.page === 'number' ? parsed.page : 0,
      pageSize: typeof parsed.pageSize === 'number' ? parsed.pageSize : DEFAULT_PAGE_SIZE,
    };
  } catch {
    return null;
  }
};

// Em-dash placeholder for empty cells — copies REPT's formatCellText so the
// table never shows a bare empty cell that's hard to read.
const formatCellText = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

const SearchPage: FC = () => {
  const navigate = useNavigate();

  // Hydrate everything from the persisted snapshot in one go so initial
  // state values are consistent (calling loadPersistedState() per
  // useState would re-read sessionStorage three times).
  const persisted = loadPersistedState();
  const [form, setForm] = useState<SearchForm>(() => persisted?.form ?? EMPTY_FORM);
  const [results, setResults] = useState<SearchResult[] | null>(
    () => persisted?.results ?? null,
  );
  const [totalElements, setTotalElements] = useState<number>(persisted?.totalElements ?? 0);
  const [page, setPage] = useState<number>(persisted?.page ?? 0);
  const [pageSize, setPageSize] = useState<number>(persisted?.pageSize ?? DEFAULT_PAGE_SIZE);
  // Loading + error are not persisted: they describe an in-flight call, not
  // user-saved state. A page reload while a request is mid-flight should
  // simply forget that call and let the user resubmit if they want.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Client-search modal open/close. The modal owns its own search state;
  // we only care here whether it's visible and what client gets picked.
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  // Errors render as a slide-in toast (top-right corner), not an
  // inline notification in the results area. The `error` state still
  // gates render conditions below ("no results" empty state should
  // not show when the search itself failed). Fires on any transition
  // to a non-null value; falsy → no-op.
  const { display } = useNotification();
  useEffect(() => {
    if (error) {
      display({ kind: 'error', title: 'Search failed', subtitle: error, timeout: 5000 });
    }
  }, [error, display]);

  // Code-list state. Both lists load once on mount via the dedicated
  // GET endpoints. We keep them in component state (rather than a global
  // store) because the page is the only consumer. orgUnitsLoading is
  // tracked so the dropdown shows a placeholder while data arrives;
  // status doesn't need its own loading flag because the page works fine
  // with an empty status list (the user can submit the search anyway).
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);

  useEffect(() => {
    // Parallel load — both endpoints are independent. We deliberately do
    // NOT bail on a single failure: org units might 404 while statuses
    // succeed, and partial dropdown availability is better than empty
    // dropdowns. Failures bubble into the page-level error banner.
    let cancelled = false;
    setCodeListsLoading(true);
    Promise.allSettled([getOrgUnits(), getFspStatusCodes()]).then((results) => {
      if (cancelled) return;
      const [orgRes, statusRes] = results;
      if (orgRes.status === 'fulfilled') setOrgUnits(orgRes.value);
      if (statusRes.status === 'fulfilled') setStatusOptions(statusRes.value);
      const failures = results
        .map((r, i) => (r.status === 'rejected' ? `${i === 0 ? 'org units' : 'status codes'}: ${r.reason}` : null))
        .filter(Boolean);
      if (failures.length > 0) {
        setError(`Failed to load ${failures.join('; ')}`);
      }
      setCodeListsLoading(false);
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
        } satisfies PersistedSearchState),
      );
    } catch {
      // Storage quota or serialization issue — non-fatal.
    }
  }, [form, results, totalElements, page, pageSize]);

  const set = <K extends keyof SearchForm>(key: K, value: SearchForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Strip non-digit characters from a free-text input as the user
  // types — used for FSP ID (DB type NUMBER(10)) and Agreement Holder
  // (VARCHAR2(8) but BCGov client numbers are numeric, padded with
  // leading zeros). REPT's project search uses the same pattern for
  // its numeric file inputs. Sanitizing on change is friendlier than
  // showing a post-submit error.
  const setDigitsOnly = <K extends keyof SearchForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, e.target.value.replace(/\D/g, '') as SearchForm[K]);

  // The actual fetch. Page + size come in explicitly so handleSubmit can
  // reset to page 0 on a new search while handlePagination can preserve
  // criteria and just change the slice. Sort is fixed for now (fspId
  // desc); when column-header sorting lands these become parameters too.
  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      // Cross-field validation that HTML5 patterns can't express. Legacy
      // DateRangeCompareValidator did this server-side; mirror it on
      // the client so the request doesn't waste a backend round-trip.
      // Lexicographic comparison is correct for YYYY-MM-DD strings.
      if (form.dateFrom && form.dateTo && form.dateFrom > form.dateTo) {
        setError('Date From must be on or before Date To.');
        setResults([]);
        setTotalElements(0);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await searchFsp({
          // Form field names happen to match the backend DTO names for
          // status / amend name / date type / approval but not for the
          // rest (orgUnit → orgUnitNo, fspName → fspPlanName, etc.), so
          // this mapping is explicit rather than a generic spread.
          fspId: form.fspId,
          fspPlanName: form.fspName,
          orgUnitNo: form.orgUnit,
          ahClientNumber: form.holder,
          fspAmendmentName: form.amendName,
          fspDateStart: form.dateFrom,
          fspDateEnd: form.dateTo,
          // Date Type is only meaningful when paired with a date — the
          // proc otherwise filters by an unused dimension and either
          // returns nothing or scans a wider index than needed. Drop
          // it when both date bounds are empty so the proc treats this
          // as "no date filter at all".
          fspDateType: form.dateFrom || form.dateTo ? form.dateType : '',
          fspStatusCode: form.status,
          approvalRequired: form.approval,
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
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
        setTotalElements(0);
      } finally {
        setLoading(false);
      }
    },
    [form],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // New search → always start at page 0, but preserve the user's
      // chosen page size so they don't lose "show 50 per page" on every
      // submit.
      void runSearch(0, pageSize);
    },
    [runSearch, pageSize],
  );

  // Carbon's Pagination component is 1-indexed; our backend (and the
  // Pageable convention) is 0-indexed. Convert at the boundary.
  const handlePagination = useCallback(
    ({ page: newPage, pageSize: newSize }: { page: number; pageSize: number }) => {
      void runSearch(newPage - 1, newSize);
    },
    [runSearch],
  );

  const handleClear = useCallback(() => {
    setForm(EMPTY_FORM);
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
  }, []);

  const hasResults = results !== null && results.length > 0;

  // While the code tables are still loading, render only a centered
  // spinner — no header, no form, no dropdowns flashing in their
  // disabled state. withOverlay={false} suppresses Carbon's default
  // full-viewport dim layer so the surrounding chrome (Layout header,
  // side nav) keeps responding normally; the centering div takes the
  // available content height and parks the spinner in the middle.
  if (codeListsLoading) {
    return (
      <div className="fsp-search__loading" role="status" aria-live="polite">
        <Loading description="Loading…" withOverlay={false} />
      </div>
    );
  }

  return (
    <Grid fullWidth className="default-grid fsp-search-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-search__header">
          <h1>Search</h1>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <Tile className="fsp-search__tile">
          <form className="fsp-search__form" onSubmit={handleSubmit}>
            <div className="fsp-search__field-grid">
              <Select
                id="search-orgUnit"
                labelText="Organization Unit"
                value={form.orgUnit}
                onChange={(e) => set('orgUnit', e.target.value)}
              >
                <SelectItem value="" text="All organization units" />
                {orgUnits.map((o) => (
                  <SelectItem
                    key={o.code}
                    value={o.code}
                    text={o.description || o.code}
                  />
                ))}
              </Select>

              {/* DB column FOREST_STEWARDSHIP_PLAN.FSP_ID is NUMBER(10).
                  setDigitsOnly strips any non-digit as it's typed —
                  matches REPT's project-file sanitizer pattern. */}
              <TextInput
                id="search-fspId"
                labelText="FSP ID"
                value={form.fspId}
                onChange={setDigitsOnly('fspId')}
                maxLength={10}
                inputMode="numeric"
                autoComplete="off"
              />

              <Select
                id="search-status"
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
                id="search-fspName"
                labelText="FSP Name"
                value={form.fspName}
                onChange={(e) => set('fspName', e.target.value)}
                maxLength={120}
              />

              <TextInput
                id="search-amendName"
                labelText="Amendment Name"
                value={form.amendName}
                onChange={(e) => set('amendName', e.target.value)}
                maxLength={30}
              />

              {/* DB column FSP_AGREEMENT_HOLDER.CLIENT_NUMBER is
                  VARCHAR2(8 BYTE) but BCGov client numbers are numeric
                  (padded with leading zeros), so same digits-only
                  sanitizer as FSP ID with the smaller max. The search
                  icon button beside the input opens the SIL21 client
                  picker modal — mirrors the legacy fsp100Search.jsp
                  "<img src='search.gif'>" trigger next to its holder
                  text input. */}
              <div className="fsp-search__holder-field">
                <TextInput
                  id="search-holder"
                  labelText="Agreement Holder"
                  value={form.holder}
                  onChange={setDigitsOnly('holder')}
                  maxLength={8}
                  inputMode="numeric"
                  autoComplete="off"
                />
                <Button
                  kind="ghost"
                  size="md"
                  hasIconOnly
                  renderIcon={SearchIcon}
                  iconDescription="Search for client"
                  tooltipPosition="left"
                  onClick={() => setClientPickerOpen(true)}
                  className="fsp-search__holder-trigger"
                />
              </div>

              <Select
                id="search-approval"
                labelText="Approval Required"
                value={form.approval}
                onChange={(e) => set('approval', e.target.value)}
              >
                {APPROVAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} text={o.label} />
                ))}
              </Select>

              {/* fsp-search__row-start forces the Date Type select to start
                  in column 1 at the lg breakpoint, dropping it (and the
                  Date From / Date To range picker that follows) onto a
                  fresh row 3. Without it the auto-flow grid would tuck
                  Date Type into the empty cell after Approval Required. */}
              <Select
                id="search-dateType"
                className="fsp-search__row-start"
                labelText="Date Type"
                value={form.dateType}
                onChange={(e) => set('dateType', e.target.value)}
              >
                {DATE_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} text={o.label} />
                ))}
              </Select>

              {/* See SearchPage.scss for the flex rules that make Date From
                  and Date To split this single grid cell 50/50 horizontally.
                  className="fsp-search__date-range" lands on the outer
                  .cds--form-item wrapper Carbon emits around the picker. */}
              <DatePicker
                className="fsp-search__date-range"
                datePickerType="range"
                dateFormat="Y-m-d"
                value={
                  form.dateFrom || form.dateTo
                    ? [form.dateFrom, form.dateTo].filter(Boolean)
                    : []
                }
                onChange={(dates) => {
                  const fmt = (d: Date | undefined) =>
                    d ? d.toISOString().slice(0, 10) : '';
                  set('dateFrom', fmt(dates[0]));
                  set('dateTo', fmt(dates[1]));
                }}
              >
                {/* Carbon's default `pattern` on DatePickerInput is
                    `\d{1,4}/\d{1,2}/\d{1,2}` (M/D/Y). Since we render
                    dates as YYYY-MM-DD via dateFormat="Y-m-d", that
                    default pattern fails HTML5 constraint validation on
                    submit ("Please match the requested format"). Override
                    with the matching dashed pattern. */}
                <DatePickerInput
                  id="search-dateFrom"
                  labelText="Date From"
                  placeholder="YYYY-MM-DD"
                  pattern="\d{4}-\d{2}-\d{2}"
                />
                <DatePickerInput
                  id="search-dateTo"
                  labelText="Date To"
                  placeholder="YYYY-MM-DD"
                  pattern="\d{4}-\d{2}-\d{2}"
                />
              </DatePicker>
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

              {/* The Search button stays mounted; only its label and
                  icon swap while a request is in flight. A small
                  inline Loading replaces the magnifying-glass icon
                  (Carbon's `small` variant is sized to fit a Button's
                  icon slot). Keeping the same Button instance avoids
                  the layout jump you'd get from swapping it for a
                  whole different widget. */}
              <Button
                type="submit"
                size="md"
                disabled={loading}
                renderIcon={loading ? SearchingIcon : SearchIcon}
              >
                {loading ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </form>
        </Tile>
      </Column>

      {results !== null && (
        <Column sm={4} md={8} lg={16}>
          <Tile className="fsp-search__tile">
            <Stack gap={4}>
              {hasResults && (
                <>
                  {/* Position-relative wrapper so the loading overlay
                      can absolutely-position itself inside the table
                      bounds. While loading, the inner wrapper gets
                      .fsp-search__table--loading which dims the table
                      and disables pointer-events; the overlay parks a
                      centered spinner on top. Both come off together
                      when the next page lands. */}
                  <div className="fsp-search__table-container">
                    <div className={loading ? 'fsp-search__table--loading' : undefined}>
                      <div className="bordered-table">
                        <DataTable rows={results!} headers={HEADERS}>
                          {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
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
                                  {rows.map((row) => {
                                    // `row.id` is built as "${fspId}-${index}";
                                    // strip the trailing index to recover the
                                    // bare FSP ID for navigation. Amendment
                                    // number comes from its own column cell.
                                    const fspIdRaw = String(row.id).replace(/-\d+$/, '');
                                    const amendmentNumber =
                                      (row.cells.find(
                                        (c) => c.info.header === 'amendNo',
                                      )?.value as string | undefined) ?? '';
                                    const goToFsp = () => {
                                      const params = new URLSearchParams({
                                        fspId: fspIdRaw,
                                      });
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
                                              <Tag
                                                type={STATUS_TAG_TYPE_BY_DESC[value] ?? 'gray'}
                                                size="sm"
                                              >
                                                {value}
                                              </Tag>
                                            </TableCell>
                                          );
                                        }
                                        return (
                                          <TableCell key={cell.id}>{formatCellText(value)}</TableCell>
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

                  {/* Carbon Pagination is 1-indexed; handlePagination
                      converts to the 0-indexed backend convention. The
                      cross-app pagination styling (rounded corners, no
                      borders on inline selects, etc.) is set globally in
                      src/styles/_overrides.scss — same rules REPT uses. */}
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

              {!hasResults && results !== null && !error && (
                // No-results state still gets a one-line message — the
                // empty Tile would otherwise leave the user wondering
                // whether the search ran at all.
                <p className="fsp-search__summary">No results match your search.</p>
              )}
            </Stack>
          </Tile>
        </Column>
      )}

      {/* Modal lives at the Grid root so it portals/positions over the
          whole page. Mounted unconditionally; ClientSearchModal handles
          its own open/closed visibility and resets internal state on
          each open so stale criteria from a previous picker session
          don't leak across. */}
      <ClientSearchModal
        open={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        onSelect={(client) => {
          // Backend CLIENT_NUMBER is the legacy Agreement Holder
          // identifier on FSP_AGREEMENT_HOLDER. Empty/null guards via
          // the empty-string fallback so the field's `value` prop
          // never goes undefined.
          set('holder', client.clientNumber?.trim() ?? '');
        }}
      />
    </Grid>
  );
};

export default SearchPage;
