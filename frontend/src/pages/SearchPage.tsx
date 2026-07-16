import {
  Button,
  ComboBox,
  DataTable,
  DataTableSkeleton,
  DatePicker,
  DatePickerInput,
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
import {CheckmarkFilled, Search as SearchIcon, SubtractAlt} from '@carbon/icons-react';
import {type FC, type FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';

import {type ClientSearchResult, searchClientsAuto} from '@/services/clientSearch';
import {useNotification} from '@/context/notification/useNotification';
import {safeErrorMessage} from '@/lib/errorMessage';
import {type CodeOption, type FspSearchResult, getFspStatusCodes, getOrgUnits, searchFsp,} from '@/services/fspSearch';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import { formatDate } from '@/utils/formatDate';
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
  /** Unique React key for Carbon DataTable. `${fspId}-${index}` to
   *  disambiguate the same FSP appearing across paginated slices. */
  id: string;
  /** Bare FSP ID used as the displayed value + navigation target. */
  fspId: string;
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
  { key: 'fspId', header: 'FSP ID' },
  { key: 'amendNo', header: 'Version' },
  { key: 'name', header: 'FSP name' },
  { key: 'amendName', header: 'Amendment name' },
  { key: 'status', header: 'Status' },
  { key: 'orgUnit', header: 'Org unit' },
  { key: 'effectiveDate', header: 'Effective date' },
  { key: 'expiryDate', header: 'Expiry date' },
  { key: 'holder', header: 'Agreement holder' },
  { key: 'approvalRequired', header: 'Approval required' },
];


// Y/N indicator → readable cell text. Anything else (null, empty, unexpected
// value) falls through to the em-dash placeholder via formatCellText.
const formatApprovalRequired = (value: string | null | undefined): string => {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return 'No';
  return '';
};

// Backend returns dates as YYYY-MM-DD; the table renders them in the
// design's "MMM D, YYYY" form (e.g. "Apr 10, 2021") via the shared util.

// Label for a client suggestion in the Agreement Holder autocomplete:
// "Name (ACRONYM) · #number", with absent parts dropped.
const clientLabel = (c: ClientSearchResult): string => {
  const parts: string[] = [];
  const name = c.clientName?.trim();
  if (name) parts.push(name);
  const acronym = c.clientAcronym?.trim();
  if (acronym) parts.push(`(${acronym})`);
  const number = c.clientNumber?.trim();
  const label = parts.join(' ');
  if (number) return label ? `${label} · ${number}` : number;
  return label;
};

const mapToSearchResult = (r: FspSearchResult, index: number): SearchResult => ({
  // DataTable requires a unique id per row. Within one page of results
  // fspId is unique, but if the user pages backward and forward we
  // could collide across pages — disambiguate with the absolute row
  // index inside the current page. The bare fspId lives in its own
  // field so the FSP ID column displays cleanly and the row-click
  // handler doesn't need to strip the suffix.
  id: r.fspId?.trim() ? `${r.fspId.trim()}-${index}` : `row-${index}`,
  fspId: r.fspId?.trim() ?? '',
  amendNo: r.fspAmendmentNumber ?? '',
  name: r.planName ?? '',
  amendName: r.fspAmendmentName ?? '',
  status: r.fspStatusDesc ?? '',
  orgUnit: r.orgUnitCode ?? '',
  effectiveDate: formatDate(r.planStartDate),
  expiryDate: formatDate(r.planEndDate),
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
// Versioned key — bump the suffix whenever SearchResult's shape changes
// so a stale persistence from before the schema change is discarded
// instead of silently rendering with missing fields.
const STORAGE_KEY = 'fsp.search.state.v2';

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
    // Defensive shape patch: rows persisted before the schema split
    // didn't carry the `fspId` field — derive it from the suffixed id
    // so the column doesn't render blank on first paint after upgrade.
    const results = parsed.results
      ? parsed.results.map((r) => ({
          ...r,
          fspId: r.fspId ?? String(r.id ?? '').replace(/-\d+$/, ''),
        }))
      : null;
    return {
      form: { ...EMPTY_FORM, ...parsed.form },
      results,
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
  // Agreement Holder autocomplete (replaces the old client-search modal).
  // form.holder still carries the resolved client *number* — the actual
  // search filter; these track the typed term, fetched suggestions, and
  // the picked client for the ComboBox's controlled display.
  const [holderTerm, setHolderTerm] = useState('');
  const [holderItems, setHolderItems] = useState<ClientSearchResult[]>([]);
  const [holderSelected, setHolderSelected] = useState<ClientSearchResult | null>(null);

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
    // NOT bail on a single failure: one might 404 while the other
    // succeeds, and partial availability is better than empty dropdowns.
    // getOrgUnits returns the numeric-keyed list used by the dropdown
    // filter (the Org Unit cell renders the codes verbatim, no lookup).
    let cancelled = false;
    setCodeListsLoading(true);
    Promise.allSettled([
      getOrgUnits(),
      getFspStatusCodes(),
    ]).then((results) => {
      if (cancelled) return;
      const [orgRes, statusRes] = results;
      if (orgRes.status === 'fulfilled') setOrgUnits(orgRes.value);
      if (statusRes.status === 'fulfilled') setStatusOptions(statusRes.value);
      const failures = results
        .map((r, i) => {
          if (r.status !== 'rejected') return null;
          const label = ['org units', 'status codes'][i] ?? 'lookup';
          return `${label}: ${r.reason}`;
        })
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
        setError(safeErrorMessage(e));
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

  // Auto-fire on every mount so navigating back to Search always re-runs
  // against the persisted criteria (rather than showing the cached
  // results from the last visit). One-shot ref so edits to the form
  // during the same mount don't re-trigger. Resumes on the persisted
  // page / page-size so the user lands on the same slice.
  const autoSearchFiredRef = useRef(false);
  useEffect(() => {
    if (autoSearchFiredRef.current) return;
    autoSearchFiredRef.current = true;
    void runSearch(persisted?.page ?? 0, persisted?.pageSize ?? DEFAULT_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSearch]);

  const handleClear = useCallback(() => {
    setForm(EMPTY_FORM);
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
    setHolderTerm('');
    setHolderItems([]);
    setHolderSelected(null);
  }, []);

  // Debounced Agreement Holder lookup — same shape as nr-silva's
  // ForestClientInput: wait 300ms after the last keystroke, skip terms
  // under 3 chars, and tolerate a failed fetch by clearing the list.
  useEffect(() => {
    const term = holderTerm.trim();
    if (term.length < 3) {
      setHolderItems([]);
      return;
    }
    const handle = setTimeout(() => {
      searchClientsAuto(term)
        .then(setHolderItems)
        .catch(() => setHolderItems([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [holderTerm]);

  // Typing replaces any prior selection and clears the holder filter
  // (until a new client is picked). Ignore the synthetic input change
  // Carbon fires when it sets the input to the selected item's label.
  const handleHolderInput = (text: string) => {
    if (holderSelected && clientLabel(holderSelected) === text) return;
    setHolderSelected(null);
    if (form.holder) set('holder', '');
    setHolderTerm(text);
  };

  const handleHolderSelect = (data: { selectedItem?: ClientSearchResult | null }) => {
    const client = data.selectedItem ?? null;
    setHolderSelected(client);
    set('holder', client?.clientNumber?.trim() ?? '');
  };

  // Render the Org Unit cell as the 3-letter org_unit_code values (e.g.
  // "DCC", "DKM") — business wants the code, not the full district name.
  // The search row already returns the codes comma-separated; we just
  // split + re-join with newlines so multiple districts render one per
  // line via white-space: pre-line on .fsp-search__table body td. Done
  // at display time so results restored from sessionStorage stack too.
  const displayResults = useMemo(() => {
    if (!results) return null;
    return results.map((r) => ({
      ...r,
      orgUnit: r.orgUnit
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .join('\n'),
    }));
  }, [results]);

  const hasResults = displayResults !== null && displayResults.length > 0;

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
    <div className="fsp-search-page">
      <div className="fsp-search__header">
        <div>
          <h1>FSP Search</h1>
          <p className="fsp-search__subtitle">
            Search and view Forest Stewardship Plans across BC districts.
          </p>
        </div>
      </div>

      <Tile className="fsp-search__tile">
        <form className="fsp-search__form" onSubmit={handleSubmit}>
            <div className="fsp-search__field-grid">
              <Select
                id="search-orgUnit"
                labelText="Organization unit"
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
                labelText="FSP name"
                value={form.fspName}
                onChange={(e) => set('fspName', e.target.value)}
                maxLength={120}
              />

              <TextInput
                id="search-amendName"
                labelText="Amendment name"
                value={form.amendName}
                onChange={(e) => set('amendName', e.target.value)}
                maxLength={30}
              />

              <Select
                id="search-approval"
                labelText="Approval required"
                value={form.approval}
                onChange={(e) => set('approval', e.target.value)}
              >
                {APPROVAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} text={o.label} />
                ))}
              </Select>

              {/* Agreement Holder autocomplete (SIL21 client search).
                  Type a name, acronym, or client number → pick a client →
                  form.holder is set to its client number, which is the
                  actual FSP search filter (ahClientNumber). Replaces the
                  old magnifying-glass-opens-a-modal picker. Wrapped in a
                  cell that spans two grid columns (see SCSS). */}
              <div className="fsp-search__holder-cell">
                <ComboBox
                  id="search-holder"
                  titleText="Agreement holder"
                  helperText="Enter name, acronym, or client number (min. 3 characters)"
                  items={holderItems}
                  itemToString={(item) => (item ? clientLabel(item) : '')}
                  selectedItem={holderSelected}
                  onInputChange={handleHolderInput}
                  onChange={handleHolderSelect}
                />
              </div>

              {/* Section heading that groups the date fields below. Spans
                  the full grid width (see SCSS), so it also forces the
                  Date Type select onto a fresh row. */}
              <h2 className="fsp-search__group-heading">Date range</h2>

              {/* fsp-search__row-start forces the Date Type select to start
                  in column 1 at the lg breakpoint, dropping it (and the
                  Date From / Date To range picker that follows) onto a
                  fresh row. Without it the auto-flow grid would tuck
                  Date Type into the empty cell after Approval Required. */}
              <Select
                id="search-dateType"
                className="fsp-search__row-start"
                labelText="Date type"
                value={form.dateType}
                onChange={(e) => set('dateType', e.target.value)}
              >
                {DATE_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} text={o.label} />
                ))}
              </Select>

              {/* Two INDEPENDENT single date pickers — not a connected
                  range. Each has its own calendar and updates only its own
                  field. dateFormat="Y-m-d" + the dashed pattern keep
                  HTML5 constraint validation happy (Carbon's default
                  pattern is M/D/Y and would reject our YYYY-MM-DD). */}
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={form.dateFrom ? [form.dateFrom] : []}
                onChange={(dates) =>
                  set('dateFrom', dates[0] ? dates[0].toISOString().slice(0, 10) : '')
                }
              >
                <DatePickerInput
                  id="search-dateFrom"
                  labelText="Date from"
                  placeholder="YYYY-MM-DD"
                  pattern="\d{4}-\d{2}-\d{2}"
                />
              </DatePicker>

              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={form.dateTo ? [form.dateTo] : []}
                onChange={(dates) =>
                  set('dateTo', dates[0] ? dates[0].toISOString().slice(0, 10) : '')
                }
              >
                <DatePickerInput
                  id="search-dateTo"
                  labelText="Date to"
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
                Clear all
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

      {/* Results section is a flat sibling of the form Tile so there's
          no Grid / Column padding between them. Only .cds--content's
          own 1.5rem horizontal padding has to be negated (see
          SearchPage.scss). */}
      {(loading || results !== null) && (
        <div className="fsp-search__results-fullbleed">
          <div className="fsp-search__results">
            {loading ? (
              // In-flight: the banner shows "Searching" + a spinner in
              // place of the result count, and the table is a skeleton.
              // Covers the first search (results still null) and any
              // pagination fetch.
              <>
                <div className="fsp-search__results-header">
                  <span className="fsp-search__results-count fsp-search__results-count--searching">
                    Searching
                    <span className="fsp-search__searching-spinner" aria-hidden="true" />
                  </span>
                </div>
                <div className="fsp-search__table-container">
                  <div className="fsp-search__table">
                    <DataTableSkeleton
                      headers={HEADERS}
                      rowCount={Math.min(pageSize, 10)}
                      showHeader={false}
                      showToolbar={false}
                      aria-label="Loading search results"
                    />
                  </div>
                </div>
              </>
            ) : hasResults ? (
              <>
                {/* Gray banner with the total result count flush-left so
                    the user has the figure in their eyeline. Banner /
                    table / pagination read as one connected block. */}
                <div className="fsp-search__results-header">
                  <span className="fsp-search__results-count">
                    {totalElements.toLocaleString()}{' '}
                    {totalElements === 1 ? 'result' : 'results'} found
                  </span>
                </div>
                <div className="fsp-search__table-container">
                  <div className="fsp-search__table">
                      <DataTable rows={displayResults!} headers={HEADERS}>
                          {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
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
                                  {rows.map((row) => {
                                    // Pull the bare FSP ID and amendment number
                                    // from their dedicated cells. `row.id` is the
                                    // React key (`${fspId}-${index}`) and is not
                                    // safe to use for navigation if the user has
                                    // an FSP id that happens to contain a dash.
                                    const fspIdRaw =
                                      (row.cells.find(
                                        (c) => c.info.header === 'fspId',
                                      )?.value as string | undefined) ?? '';
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
                                              <StatusTag status={value} />
                                            </TableCell>
                                          );
                                        }
                                        // Amendment 0 is the original plan — display "Original
                                        // FSP" but keep the raw "0" value (the nav URL above
                                        // reads it from the cell value).
                                        if (cell.info.header === 'amendNo') {
                                          return (
                                            <TableCell key={cell.id}>
                                              {value === '0' ? 'Original' : formatCellText(value)}
                                            </TableCell>
                                          );
                                        }
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
                                          return (
                                            <TableCell key={cell.id}>{formatCellText(value)}</TableCell>
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
            ) : (
              // Not loading and the search came back empty — a centered
              // empty state (pictogram + title + body) matching the design.
              results !== null && !error && (
                <EmptyState
                  title="No results found"
                  body={
                    <>
                      No records match your search criteria.
                      <br />
                      Try adjusting your filters and searching again.
                    </>
                  }
                />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchPage;
