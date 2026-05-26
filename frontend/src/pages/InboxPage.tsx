import {
  Button,
  Column,
  DataTable,
  Grid,
  InlineNotification,
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
import { Search as SearchIcon } from '@carbon/icons-react';
import { useCallback, useEffect, useState, type FC, type FormEvent } from 'react';

import ClientSearchModal from '@/components/ClientSearchModal';
import {
  getFspExtent,
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
  // "1" if the FSP has at least one FDU polygon (legacy gate on whether
  // to render the Map View link); "0" otherwise. Stored as a cell so
  // Carbon's DataTable carries it through; the renderer reads it to
  // decide whether to render the trigger.
  hasMapView: '0' | '1';
}

// Map View base URL (configurable per environment). The legacy app
// fed this to a JS function that appended `&extent=...&catalogLayers=...`;
// we do the same here, but only after the user clicks (the extent
// comes from a per-row backend fetch). Falls back to empty so the
// trigger is suppressed when the env isn't configured.
const MAP_VIEWER_URL = (import.meta.env.VITE_MAP_VIEWER_URL as string | undefined) ?? '';

// Catalog-layer IDs the legacy fsp200Inbox.jsp appended to the inbox
// map URL. Per nr-fsp/.../javascript/navigation.js openMapView():
//   url + "&extent=" + extent + "&catalogLayers=1417,1418,1419,1420"
const MAP_VIEWER_LAYERS = '1417,1418,1419,1420';

const HEADERS = [
  { key: 'fspId', header: 'FSP ID' },
  { key: 'amendNo', header: 'Amendment #' },
  { key: 'extNo', header: 'Ext #' },
  { key: 'name', header: 'FSP Name' },
  { key: 'status', header: 'Status' },
  { key: 'submitted', header: 'Submitted' },
  { key: 'submittedBy', header: 'Submitted By' },
  { key: 'holder', header: 'Agreement Holder' },
  // Trailing actions column — no header text, just the Map View
  // trigger per the legacy inbox JSP. Carbon renders an empty <th>
  // for "". Cell value is the FDU-presence flag (see InboxRow.hasMapView).
  { key: 'hasMapView', header: '' },
];

// Same description-keyed Tag color mapping as SearchPage. The inbox
// cursor returns the human label in fspStatusDesc; unknown values
// fall back to gray.
const STATUS_TAG_TYPE_BY_DESC: Record<string, 'green' | 'blue' | 'gray' | 'red' | 'warm-gray' | 'purple'> = {
  Approved: 'green',
  Submitted: 'blue',
  Draft: 'gray',
  Rejected: 'red',
  Expired: 'warm-gray',
  'Opportunity to be Heard Sent': 'purple',
};

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
  submitted: r.planSubmissionDate ?? '',
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
const SORT_BY = 'fspId';
const SORT_DIR: 'asc' | 'desc' = 'desc';

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
  const persisted = loadPersistedState();
  const [form, setForm] = useState<InboxForm>(() => persisted?.form ?? EMPTY_FORM);
  const [results, setResults] = useState<InboxRow[] | null>(() => persisted?.results ?? null);
  const [totalElements, setTotalElements] = useState<number>(persisted?.totalElements ?? 0);
  const [page, setPage] = useState<number>(persisted?.page ?? 0);
  const [pageSize, setPageSize] = useState<number>(persisted?.pageSize ?? DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the org-units code list is needed here — status is hardcoded
  // (see STATUS_OPTIONS comment). No separate status fetch on mount.
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  // Tracks which row's Map View extent fetch is currently in flight.
  // Single value rather than a per-row map: the legacy UX opened one
  // map at a time, multi-fire would just race anyway, and limiting to
  // one keeps the cell spinner state easy to reason about.
  const [mapExtentLoadingRowId, setMapExtentLoadingRowId] = useState<string | null>(null);

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
        setError(`Failed to load org units: ${e instanceof Error ? e.message : String(e)}`);
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

  const handleClear = useCallback(() => {
    setForm(EMPTY_FORM);
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
  }, []);

  /**
   * Open the legacy Map View for a single row. Lazy: fetches the MBR
   * from /extent only when the user clicks, then redirects a
   * pre-opened blank tab to
   *   MAP_VIEWER_URL + &extent=<mbr>&catalogLayers=1417,1418,1419,1420
   *
   * The popup is opened with no `noopener` flag — that flag would
   * make Chrome/Firefox/Safari return `null` from window.open even
   * when the popup itself opens successfully, leaving us no handle to
   * navigate it. Since we replace the popup's URL with a cross-origin
   * arcmaps page immediately, the opener-access risk is effectively
   * neutered by the same-origin policy after navigation anyway.
   */
  const handleOpenMapView = useCallback(
    async (rowId: string, fspId: string, amendNo: string) => {
      if (mapExtentLoadingRowId) return;
      if (!MAP_VIEWER_URL) {
        setError('Map View base URL is not configured. Set VITE_MAP_VIEWER_URL.');
        return;
      }
      const popup = window.open('about:blank', '_blank');
      if (!popup) {
        setError('Pop-up was blocked. Allow pop-ups for this site to use Map View.');
        return;
      }
      setMapExtentLoadingRowId(rowId);
      try {
        const { extent } = await getFspExtent(fspId, amendNo);
        if (!extent) {
          popup.close();
          setError(`FSP ${fspId} has no spatial data — Map View unavailable.`);
          return;
        }
        const sep = MAP_VIEWER_URL.includes('?') ? '&' : '?';
        // Legacy navigation.js#openMapView built the URL by raw string
        // concat — no encodeURIComponent on either value. Match that
        // byte-for-byte: commas in extent/catalogLayers are reserved
        // but not delimiters here, and arcmaps' parser keys off the
        // exact literal form. Encoding the commas would technically be
        // RFC-correct but breaks parity with the legacy app.
        const url = `${MAP_VIEWER_URL}${sep}extent=${extent}&catalogLayers=${MAP_VIEWER_LAYERS}`;
        popup.location.replace(url);
      } catch (e) {
        popup.close();
        setError(
          e instanceof Error ? e.message : `Could not load Map View for FSP ${fspId}.`,
        );
      } finally {
        setMapExtentLoadingRowId(null);
      }
    },
    [mapExtentLoadingRowId],
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
    <Grid fullWidth className="default-grid fsp-inbox-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-inbox__header">
          <h1>Inbox</h1>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <Tile className="fsp-inbox__tile">
          <form className="fsp-inbox__form" onSubmit={handleSubmit}>
            <div className="fsp-inbox__field-grid">
              <Select
                id="inbox-orgUnit"
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
                labelText="FSP Name"
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

              {/* Same picker pattern as SearchPage's Agreement Holder
                  field — TextInput + a ghost-Button icon that opens
                  the SIL21 client modal. */}
              <div className="fsp-inbox__holder-field">
                <TextInput
                  id="inbox-holder"
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
                  className="fsp-inbox__holder-trigger"
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
      </Column>

      {(error || results !== null) && (
        <Column sm={4} md={8} lg={16}>
          <Tile className="fsp-inbox__tile">
            <Stack gap={4}>
              {error && (
                <InlineNotification
                  kind="error"
                  title="Inbox load failed"
                  subtitle={error}
                  lowContrast
                  hideCloseButton
                />
              )}

              {hasResults && (
                <>
                  <div className="fsp-inbox__table-container">
                    <div className={loading ? 'fsp-inbox__table--loading' : undefined}>
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
                                  {rows.map((row) => (
                                    <TableRow {...getRowProps({ row })} key={row.id}>
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
                                          const isLoading = mapExtentLoadingRowId === row.id;
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
                                                  onClick={() =>
                                                    void handleOpenMapView(row.id, fspIdCell, amendCell ?? '0')
                                                  }
                                                  disabled={isLoading}
                                                >
                                                  {isLoading ? 'Loading…' : 'Map View'}
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
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          )}
                        </DataTable>
                      </div>
                    </div>
                    {loading && (
                      <div
                        className="fsp-inbox__table-overlay"
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

              {!hasResults && results !== null && !error && (
                <p className="fsp-inbox__summary">No inbox items match your criteria.</p>
              )}
            </Stack>
          </Tile>
        </Column>
      )}

      <ClientSearchModal
        open={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        onSelect={(client) => {
          set('holder', client.clientNumber?.trim() ?? '');
        }}
      />
    </Grid>
  );
};

export default InboxPage;
