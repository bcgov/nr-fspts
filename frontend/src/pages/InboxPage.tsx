import {
  Button,
  ComboBox,
  DataTable,
  DataTableSkeleton,
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
import { Search as SearchIcon } from '@carbon/icons-react';
import { useCallback, useEffect, useRef, useState, type FC, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import { useNotification } from '@/context/notification/useNotification';
import { useOrg } from '@/context/org/useOrg';
import { safeErrorMessage } from '@/lib/errorMessage';
import { type ClientSearchResult, searchClientsAuto } from '@/services/clientSearch';
import { formatDate } from '@/utils/formatDate';
import {
  getOrgUnits,
  searchInbox,
  type CodeOption,
  type FspSearchResult,
  type InboxRequest,
} from '@/services/fspSearch';
import './InboxPage.scss';

// Same SearchingIcon shim as SearchPage — Carbon's small Loading sized
// for the icon slot of a Button. Renders as the renderIcon while a
// request is in flight.
const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

// Label for a client suggestion in the Agreement Holder autocomplete:
// "Name (ACRONYM) · #number", with absent parts dropped. Kept identical to
// SearchPage so the two fields behave the same.
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

// Inbox uses a narrower status list than the global search (the proc
// returns only SUB/OHS/DFT rows by design). Hardcoded here per the
// legacy fsp200Inbox.jsp — same three values, exact same display text.
const STATUS_OPTIONS = [
  { value: 'SUB', label: 'Submitted' },
  { value: 'OHS', label: 'Opportunity to be Heard Sent' },
  { value: 'DFT', label: 'Draft' },
];

interface InboxRow {
  id: string;
  fspId: string;
  amendNo: string;
  extNo: string;
  name: string;
  status: string;
  submitted: string;
  submittedBy: string;
  holder: string;
  // "1" if the FSP has at least one FDU polygon (gate on whether to render
  // the Map View link); "0" otherwise. Stored as a cell so Carbon's
  // DataTable carries it through; the renderer reads it to decide whether
  // to render the trigger.
  hasMapView: '0' | '1';
}

const HEADERS = [
  { key: 'fspId', header: 'FSP ID' },
  { key: 'amendNo', header: 'Version' },
  { key: 'extNo', header: 'Ext #' },
  { key: 'name', header: 'FSP name' },
  { key: 'status', header: 'Status' },
  { key: 'submitted', header: 'Submitted' },
  { key: 'submittedBy', header: 'Submitted by' },
  { key: 'holder', header: 'Agreement holder' },
  // Trailing actions column — no header text, just the Map View
  // trigger per the legacy inbox JSP. Carbon renders an empty <th>
  // for "". Cell value is the FDU-presence flag (see InboxRow.hasMapView).
  { key: 'hasMapView', header: '' },
];

const mapToInboxRow = (r: FspSearchResult, index: number): InboxRow => ({
  // Same row-id pattern as SearchPage: fspId is unique within a page
  // but may collide across paginated requests; appending the index
  // disambiguates.
  id: r.fspId?.trim() ? `${r.fspId.trim()}-${index}` : `row-${index}`,
  fspId: r.fspId ?? '',
  amendNo: r.fspAmendmentNumber ?? '',
  extNo: r.extensionNumber ?? '',
  name: r.planName ?? '',
  status: r.fspStatusDesc ?? '',
  submitted: formatDate(r.planSubmissionDate),
  submittedBy: r.updateUserid ?? '',
  holder: r.agreementHolder ?? '',
  hasMapView: r.numberOfFdu && r.numberOfFdu > 0 ? '1' : '0',
});

interface InboxForm {
  orgUnit: string;
  fspId: string;
  fspName: string;
  status: string;
  holder: string;
}

const EMPTY_FORM: InboxForm = {
  orgUnit: '',
  fspId: '',
  fspName: '',
  status: '',
  holder: '',
};

const STORAGE_KEY = 'fsp.inbox.state';
const DEFAULT_PAGE_SIZE = 10;
// Multi-column sort — backend parses these as comma-delimited lists
// (InboxService.buildComparator). Status first descending puts the
// "live" statuses (Submitted, Rejected, Opportunity to be Heard Sent…)
// near the top; planSubmissionDate descending breaks ties so the most
// recently submitted FSP in each status group leads.
const SORT_BY = 'fspStatusDesc,planSubmissionDate';
const SORT_DIR = 'desc,desc';

type PersistedInboxState = {
  form: InboxForm;
  results: InboxRow[] | null;
  totalElements: number;
  page: number;
  pageSize: number;
};

const loadPersistedState = (): PersistedInboxState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedInboxState>;
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

const formatCellText = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

const InboxPage: FC = () => {
  const navigate = useNavigate();
  const persisted = loadPersistedState();
  const [form, setForm] = useState<InboxForm>(() => persisted?.form ?? EMPTY_FORM);
  const [results, setResults] = useState<InboxRow[] | null>(() => persisted?.results ?? null);
  const [totalElements, setTotalElements] = useState<number>(persisted?.totalElements ?? 0);
  const [page, setPage] = useState<number>(persisted?.page ?? 0);
  const [pageSize, setPageSize] = useState<number>(persisted?.pageSize ?? DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Errors render as a slide-in toast (top-right corner); the `error`
  // state still gates the "no results" empty-state below so we don't
  // show that message when the call itself failed.
  const { display } = useNotification();
  useEffect(() => {
    if (error) {
      display({ kind: 'error', title: 'Inbox load failed', subtitle: error, timeout: 5000 });
    }
  }, [error, display]);

  // Only the org-units code list is needed here — status is hardcoded
  // (see STATUS_OPTIONS comment). No separate status fetch on mount.
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);
  // Agreement Holder autocomplete (replaces the old client-search modal),
  // matching SearchPage. form.holder still carries the resolved client
  // *number* — the actual filter; these track the typed term, fetched
  // suggestions, and the picked client for the ComboBox's display.
  const [holderTerm, setHolderTerm] = useState('');
  const [holderItems, setHolderItems] = useState<ClientSearchResult[]>([]);
  const [holderSelected, setHolderSelected] = useState<ClientSearchResult | null>(null);

  // Active BCeID org — carried into the Leaflet map tab so a multi-org user
  // isn't re-prompted (the tab opens with noopener → fresh sessionStorage).
  const { activeOrgClientNumber } = useOrg();

  useEffect(() => {
    let cancelled = false;
    setCodeListsLoading(true);
    getOrgUnits()
      .then((list) => {
        if (cancelled) return;
        setOrgUnits(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(safeErrorMessage(e, 'Failed to load org units.'));
      })
      .finally(() => {
        if (cancelled) return;
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
        } satisfies PersistedInboxState),
      );
    } catch {
      // Non-fatal — quota / serialization issue.
    }
  }, [form, results, totalElements, page, pageSize]);

  const set = <K extends keyof InboxForm>(key: K, value: InboxForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Same digits-only sanitizer as SearchPage. FSP ID = NUMBER(10),
  // Agreement Holder client number = VARCHAR2(8) but numeric-padded.
  const setDigitsOnly = <K extends keyof InboxForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, e.target.value.replace(/\D/g, '') as InboxForm[K]);

  // Debounced Agreement Holder lookup — identical to SearchPage: wait 300ms
  // after the last keystroke, skip terms under 3 chars, tolerate a failed
  // fetch by clearing the list.
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

  // Typing replaces any prior selection and clears the holder filter (until
  // a new client is picked). Ignore the synthetic input change Carbon fires
  // when it sets the input to the selected item's label.
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

  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const criteria: InboxRequest = {
          // Form field → backend DTO field mapping. Form uses friendly
          // short names; the backend mirrors the legacy P_* params.
          orgUnitNo: form.orgUnit,
          fspId: form.fspId,
          fspPlanName: form.fspName,
          fspStatusCode: form.status,
          ahClientNumber: form.holder,
          page: nextPage,
          size: nextSize,
          sortBy: SORT_BY,
          sortDir: SORT_DIR,
        };
        const data = await searchInbox(criteria);
        setResults(data.content.map(mapToInboxRow));
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
      void runSearch(0, pageSize);
    },
    [runSearch, pageSize],
  );

  // Auto-fire on every mount so navigating back to Inbox always shows
  // fresh data against the persisted criteria (rather than the cached
  // results from the last visit). Gated by a ref so we only fire once
  // per mount even though runSearch's identity changes when the form
  // is edited. Uses the persisted page if available so the user lands
  // on the same slice they were viewing.
  const autoSearchFiredRef = useRef(false);
  useEffect(() => {
    if (autoSearchFiredRef.current) return;
    autoSearchFiredRef.current = true;
    void runSearch(persisted?.page ?? 0, persisted?.pageSize ?? DEFAULT_PAGE_SIZE);
  }, [runSearch, persisted]);

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

  /**
   * Open the standalone Leaflet FDU map for a row in a new tab — the same
   * `/fsp/map` page the FSP detail Map tab uses (our own reprojected FDU
   * outlines; replaces the old external arcmaps hand-off). The page fetches
   * its own geometry from the query params, so this is a plain synchronous
   * window.open on the click gesture (no extent pre-fetch, no popup dance).
   * The active org is threaded through so a multi-org user isn't re-prompted
   * in the noopener'd new tab (OrgProvider adopts + revalidates it).
   */
  const handleOpenMapView = useCallback(
    (fspId: string, amendNo: string) => {
      const orgParam = activeOrgClientNumber
        ? `&activeOrg=${encodeURIComponent(activeOrgClientNumber)}`
        : '';
      const url = `/fsp/map?fspId=${encodeURIComponent(fspId)}&amendmentNumber=${encodeURIComponent(amendNo || '0')}${orgParam}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [activeOrgClientNumber],
  );

  const hasResults = results !== null && results.length > 0;

  // Same gate as SearchPage: don't show the form until the org-units
  // code list lands so the user never sees empty/Loading… placeholders.
  if (codeListsLoading) {
    return (
      <div className="fsp-inbox__loading" role="status" aria-live="polite">
        <Loading description="Loading…" withOverlay={false} />
      </div>
    );
  }

  return (
    <div className="fsp-inbox-page">
      <div className="fsp-inbox__header">
        <div>
          <h1>Inbox</h1>
          <p className="fsp-inbox__subtitle">
            Forest Stewardship Plans awaiting your review and action.
          </p>
        </div>
      </div>

      <Tile className="fsp-inbox__tile">
        <form className="fsp-inbox__form" onSubmit={handleSubmit}>
            <div className="fsp-inbox__field-grid">
              <Select
                id="inbox-orgUnit"
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

              <TextInput
                id="inbox-fspId"
                labelText="FSP ID"
                value={form.fspId}
                onChange={setDigitsOnly('fspId')}
                maxLength={10}
                inputMode="numeric"
                autoComplete="off"
              />

              <TextInput
                id="inbox-fspName"
                labelText="FSP name"
                value={form.fspName}
                onChange={(e) => set('fspName', e.target.value)}
                maxLength={120}
                autoComplete="off"
              />

              <Select
                id="inbox-status"
                labelText="Status"
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
              >
                <SelectItem value="" text="All statuses" />
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} text={o.label} />
                ))}
              </Select>

              {/* Agreement Holder autocomplete (SIL21 client search) — same
                  field as SearchPage. Type a name, acronym, or client number
                  → pick a client → form.holder is set to its client number
                  (the actual filter, ahClientNumber). Spans two grid columns
                  (see SCSS). */}
              <div className="fsp-inbox__holder-cell">
                <ComboBox
                  id="inbox-holder"
                  titleText="Agreement holder"
                  helperText="Enter name, acronym, or client number (min. 3 characters)"
                  items={holderItems}
                  itemToString={(item) => (item ? clientLabel(item) : '')}
                  selectedItem={holderSelected}
                  onInputChange={handleHolderInput}
                  onChange={handleHolderSelect}
                />
              </div>
            </div>

            <div className="fsp-inbox__actions">
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
                disabled={loading}
                renderIcon={loading ? SearchingIcon : SearchIcon}
              >
                {loading ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </form>
        </Tile>

      {(loading || results !== null) && (
        <div className="fsp-inbox__results-fullbleed">
          <div className="fsp-inbox__results">
            {loading ? (
              // In-flight: the banner shows "Searching" + a spinner in place
              // of the result count, and the table is a skeleton. Covers the
              // first search (results still null) and any pagination fetch —
              // same pattern as SearchPage.
              <>
                <div className="fsp-inbox__results-header">
                  <span className="fsp-inbox__results-count fsp-inbox__results-count--searching">
                    Searching
                    <span className="fsp-inbox__searching-spinner" aria-hidden="true" />
                  </span>
                </div>
                <div className="fsp-inbox__table-container">
                  <div className="fsp-inbox__table">
                    <DataTableSkeleton
                      headers={HEADERS}
                      rowCount={Math.min(pageSize, 10)}
                      showHeader={false}
                      showToolbar={false}
                      aria-label="Loading inbox results"
                    />
                  </div>
                </div>
              </>
            ) : hasResults ? (
              <>
                {/* Gray banner directly attached to the table top —
                    holds the total inbox count flush-left, mirrors the
                    treatment on SearchPage. */}
                <div className="fsp-inbox__results-header">
                  <span className="fsp-inbox__results-count">
                    {totalElements.toLocaleString()}{' '}
                    {totalElements === 1 ? 'item' : 'items'} found
                  </span>
                </div>
                  <div className="fsp-inbox__table-container">
                    <div className="fsp-inbox__table">
                      <DataTable rows={results!} headers={HEADERS}>
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
                                    // Pull fspId + amendNo off the row cells so a
                                    // click anywhere on the row navigates to the
                                    // FSP information page (same pattern as
                                    // SearchPage). row.id is not safe for nav —
                                    // it carries an index suffix.
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
                                              {value === '0' ? 'Original' : formatCellText(value)}
                                            </TableCell>
                                          );
                                        }
                                        // Trailing actions cell. cell.info.header
                                        // is the column *key* (Carbon DataTable
                                        // contract — not the display label), so
                                        // match by key not by the empty header
                                        // string. value is '1' when the row has
                                        // FDU geometry to map, '0' otherwise;
                                        // empty cells stay blank (no em-dash
                                        // placeholder).
                                        if (cell.info.header === 'hasMapView') {
                                          const showLink = value === '1';
                                          // The fsp/amend cells live on this
                                          // same row — read them directly so we
                                          // don't have to thread the full row
                                          // record through the render closure.
                                          const fspIdCell = row.cells.find((c) => c.info.header === 'fspId')?.value as string | undefined;
                                          const amendCell = row.cells.find((c) => c.info.header === 'amendNo')?.value as string | undefined;
                                          return (
                                            <TableCell key={cell.id}>
                                              {showLink && fspIdCell ? (
                                                <button
                                                  type="button"
                                                  className="fsp-inbox__map-link"
                                                  // Stop the click from bubbling
                                                  // to the row-level navigate
                                                  // handler — Map View opens the
                                                  // Leaflet map tab, not the FSP page.
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenMapView(fspIdCell, amendCell ?? '0');
                                                  }}
                                                >
                                                  Map View
                                                </button>
                                              ) : null}
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
              // Not loading and the search came back empty.
              results !== null &&
              !error && (
                <EmptyState
                  title="No results found"
                  body={
                    <>
                      No inbox items match your search criteria.
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

export default InboxPage;
