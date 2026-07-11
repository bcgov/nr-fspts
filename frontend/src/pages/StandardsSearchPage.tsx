import {
  Button,
  DataTable,
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
import { Modal } from '@/components/Modal';
import { Search as SearchIcon } from '@carbon/icons-react';
import { type FC, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import StandardRegimeDetailPanel from '@/pages/FspInformation/tabs/StandardRegimeDetailPanel';

import { useNotification } from '@/context/notification/useNotification';
import {
  type CodeOption,
  getOrgUnits,
  getSilvTreeSpeciesCodes,
} from '@/services/fspSearch';
import {
  searchStandards,
  type StandardsSearchResult,
} from '@/services/standardsSearch';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import { formatDate } from '@/utils/formatDate';
import './SearchPage.scss';
import './StandardsSearchPage.scss';

const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

// Static option list for "Default Standards" — Yes / No / Any.
// Matches the legacy FSP501 JSP dropdown.
const DEFAULT_STANDARD_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'Y', label: 'Yes' },
  { value: 'N', label: 'No' },
];

// Status codes for Stocking Standards regimes — sourced from
// FSP_CODE_LISTS.get_std_regime_status_code. Cached on mount.
interface StatusOption {
  code: string;
  description: string;
}

interface ResultRow {
  id: string;
  standardsRegimeId: string;
  standardsRegimeName: string;
  standardsObjective: string;
  bgc: string;
  clientNumber: string;
  status: string;
  expiryDate: string;
  fspIdList: string;
}

const HEADERS = [
  { key: 'standardsRegimeId', header: 'Standards ID' },
  { key: 'standardsRegimeName', header: 'Standards name' },
  { key: 'standardsObjective', header: 'Objective' },
  { key: 'bgc', header: 'BGC' },
  { key: 'clientNumber', header: 'Client number' },
  { key: 'status', header: 'Status' },
  { key: 'expiryDate', header: 'Expiry date' },
  { key: 'fspIdList', header: 'FSP ID' },
];

interface SearchForm {
  defaultStandard: string;
  statusCode: string;
  orgUnitNo: string;
  fspId: string;
  clientNumber: string;
  clientName: string;
  standardsRegimeId: string;
  standardsRegimeName: string;
  standardsObjective: string;
  preferredSpecies: string;
  acceptableSpecies: string;
  expiryDateFrom: string;
  expiryDateTo: string;
}

const EMPTY_FORM: SearchForm = {
  defaultStandard: '',
  statusCode: '',
  orgUnitNo: '',
  fspId: '',
  clientNumber: '',
  clientName: '',
  standardsRegimeId: '',
  standardsRegimeName: '',
  standardsObjective: '',
  preferredSpecies: '',
  acceptableSpecies: '',
  expiryDateFrom: '',
  expiryDateTo: '',
};

const STORAGE_KEY = 'fsp.standards.search.state.v1';
const DEFAULT_PAGE_SIZE = 10;
const SORT_BY = 'standardsRegimeId';
const SORT_DIR: 'asc' | 'desc' = 'asc';

const formatCellText = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

const mapResult = (r: StandardsSearchResult, index: number): ResultRow => ({
  id: r.standardsRegimeId?.trim()
    ? `${r.standardsRegimeId.trim()}-${index}`
    : `row-${index}`,
  standardsRegimeId: r.standardsRegimeId?.trim() ?? '',
  standardsRegimeName: r.standardsRegimeName ?? '',
  standardsObjective: r.standardsObjective ?? '',
  bgc: r.bgc ?? '',
  clientNumber: r.clientNumber ?? '',
  status: r.status ?? '',
  expiryDate: formatDate(r.expiryDate),
  fspIdList: r.fspIdList ?? '',
});

type PersistedState = {
  form: SearchForm;
  results: ResultRow[] | null;
  totalElements: number;
  page: number;
  pageSize: number;
};

const loadPersisted = (): PersistedState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null;
    return {
      form: { ...EMPTY_FORM, ...parsed.form },
      results: parsed.results ?? null,
      totalElements:
        typeof parsed.totalElements === 'number' ? parsed.totalElements : 0,
      page: typeof parsed.page === 'number' ? parsed.page : 0,
      pageSize:
        typeof parsed.pageSize === 'number' ? parsed.pageSize : DEFAULT_PAGE_SIZE,
    };
  } catch {
    return null;
  }
};

const StandardsSearchPage: FC = () => {
  const navigate = useNavigate();
  const { display } = useNotification();

  const persisted = loadPersisted();
  const [form, setForm] = useState<SearchForm>(() => persisted?.form ?? EMPTY_FORM);
  const [results, setResults] = useState<ResultRow[] | null>(
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
  // Open dialog for the regime detail view (FSP250 mirror). null when
  // closed. The dialog routes through the regime-only GET endpoint
  // (blank fspId) so the proc's org-unit + client cursors return the
  // regime's own scope rather than scoping to an arbitrary FSP from
  // FSP_ID_LIST that may not match or be accessible to the user.
  const [selectedRegime, setSelectedRegime] = useState<{
    regimeId: string;
    regimeName: string;
  } | null>(null);

  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [speciesCodes, setSpeciesCodes] = useState<CodeOption[]>([]);
  // Regime statuses — FSP501's dropdown is sourced from std_regime_status_code,
  // which we don't have a dedicated endpoint for yet. Hard-code the
  // common values used by the proc until the lookup ships.
  const statusOptions: StatusOption[] = [
    { code: 'APP', description: 'Approved' },
    { code: 'DFT', description: 'Draft' },
    { code: 'SUB', description: 'Submitted' },
    { code: 'RPL', description: 'Replaced' },
    { code: 'RJT', description: 'Rejected' },
    { code: 'EXP', description: 'Expired' },
  ];
  const [codeListsLoading, setCodeListsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCodeListsLoading(true);
    Promise.allSettled([getOrgUnits(), getSilvTreeSpeciesCodes()]).then((r) => {
      if (cancelled) return;
      const [orgRes, spRes] = r;
      if (orgRes.status === 'fulfilled') setOrgUnits(orgRes.value);
      if (spRes.status === 'fulfilled') setSpeciesCodes(spRes.value);
      setCodeListsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (error) {
      display({ kind: 'error', title: 'Search failed', subtitle: error, timeout: 5000 });
    }
  }, [error, display]);

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
        } satisfies PersistedState),
      );
    } catch {
      /* quota / serialization — non-fatal */
    }
  }, [form, results, totalElements, page, pageSize]);

  const set = <K extends keyof SearchForm>(key: K, value: SearchForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setDigitsOnly = <K extends keyof SearchForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, e.target.value.replace(/\D/g, '') as SearchForm[K]);

  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      if (form.expiryDateFrom && form.expiryDateTo
          && form.expiryDateFrom > form.expiryDateTo) {
        setError('Expiry Date From must be on or before Expiry Date To.');
        setResults([]);
        setTotalElements(0);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await searchStandards({
          defaultStandard: form.defaultStandard,
          standardsRegimeStatusCode: form.statusCode,
          orgUnitNo: form.orgUnitNo,
          fspId: form.fspId,
          clientNumber: form.clientNumber,
          clientName: form.clientName,
          standardsRegimeId: form.standardsRegimeId,
          standardsRegimeName: form.standardsRegimeName,
          standardsObjective: form.standardsObjective,
          preferredSpecies: form.preferredSpecies,
          acceptableSpecies: form.acceptableSpecies,
          expiryDateFrom: form.expiryDateFrom,
          expiryDateTo: form.expiryDateTo,
          page: nextPage,
          size: nextSize,
          sortBy: SORT_BY,
          sortDir: SORT_DIR,
        });
        setResults(data.content.map(mapResult));
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

  const hasResults = results !== null && results.length > 0;

  if (codeListsLoading) {
    return (
      <div className="fsp-search__loading" role="status" aria-live="polite">
        <Loading description="Loading…" withOverlay={false} />
      </div>
    );
  }

  // Open the FSP250 detail dialog. The panel is rendered with a blank
  // fspId, which routes the GET through the regime-only endpoint.
  const openRegimeDetail = (row: ResultRow) => {
    if (!row.standardsRegimeId) return;
    setSelectedRegime({
      regimeId: row.standardsRegimeId,
      regimeName: row.standardsRegimeName,
    });
  };

  // Silence the unused-import warning — `useNavigate` may still be wired
  // in by a future "open full FSP page" action; keep the hook ready.
  void navigate;

  return (
    <div className="fsp-search-page">
      <div className="fsp-search__header">
        <div>
          <h1>Stocking Standards Search</h1>
          <p className="fsp-search__subtitle">
            Search and view stocking standards regimes across all Forest
            Stewardship Plans.
          </p>
        </div>
      </div>

      <Tile className="fsp-search__tile">
        <form className="fsp-search__form" onSubmit={handleSubmit}>
            <div className="fsp-search__field-grid">
              {/* Row 1: regime metadata */}
              <Select
                id="ss-defaultStandard"
                labelText="Default standards"
                value={form.defaultStandard}
                onChange={(e) => set('defaultStandard', e.target.value)}
              >
                {DEFAULT_STANDARD_OPTIONS.map((o) => (
                  <SelectItem key={o.value || 'any'} value={o.value} text={o.label} />
                ))}
              </Select>

              <Select
                id="ss-statusCode"
                labelText="Regime status"
                value={form.statusCode}
                onChange={(e) => set('statusCode', e.target.value)}
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

              {/* Row 2: containing context */}
              <Select
                id="ss-orgUnitNo"
                labelText="Organization unit"
                value={form.orgUnitNo}
                onChange={(e) => set('orgUnitNo', e.target.value)}
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
                id="ss-fspId"
                labelText="FSP ID"
                value={form.fspId}
                onChange={setDigitsOnly('fspId')}
                maxLength={10}
                inputMode="numeric"
                autoComplete="off"
              />

              {/* Row 3 (at lg): agreement holder + standards identification */}
              <TextInput
                id="ss-clientNumber"
                labelText="Client #"
                value={form.clientNumber}
                onChange={setDigitsOnly('clientNumber')}
                maxLength={8}
                inputMode="numeric"
                autoComplete="off"
              />

              <TextInput
                id="ss-clientName"
                labelText="Client name"
                value={form.clientName}
                onChange={(e) => set('clientName', e.target.value)}
                maxLength={60}
              />

              <TextInput
                id="ss-standardsRegimeId"
                labelText="Standards ID"
                value={form.standardsRegimeId}
                onChange={setDigitsOnly('standardsRegimeId')}
                maxLength={10}
                inputMode="numeric"
                autoComplete="off"
              />

              <TextInput
                id="ss-standardsRegimeName"
                labelText="Standards name"
                value={form.standardsRegimeName}
                onChange={(e) => set('standardsRegimeName', e.target.value)}
                maxLength={50}
              />

              {/* Row 4 (at lg): standards content fields fill cols 1-3,
                  cell 4 is left empty so the date pair drops to the
                  next row cleanly via the row-start break below. */}
              <TextInput
                id="ss-standardsObjective"
                labelText="Objective"
                value={form.standardsObjective}
                onChange={(e) => set('standardsObjective', e.target.value)}
                maxLength={50}
              />

              <Select
                id="ss-preferredSpecies"
                labelText="Preferred species"
                value={form.preferredSpecies}
                onChange={(e) => set('preferredSpecies', e.target.value)}
              >
                <SelectItem value="" text="Any" />
                {speciesCodes.map((s) => (
                  <SelectItem
                    key={s.code}
                    value={s.code ?? ''}
                    text={s.description || s.code || ''}
                  />
                ))}
              </Select>

              <Select
                id="ss-acceptableSpecies"
                labelText="Acceptable species"
                value={form.acceptableSpecies}
                onChange={(e) => set('acceptableSpecies', e.target.value)}
              >
                <SelectItem value="" text="Any" />
                {speciesCodes.map((s) => (
                  <SelectItem
                    key={s.code}
                    value={s.code ?? ''}
                    text={s.description || s.code || ''}
                  />
                ))}
              </Select>

              {/* Row 4 at lg: expiry date range. fsp-search__row-start
                  forces grid-column: 1 at the 4-column breakpoint so
                  the date pair always starts its own row regardless of
                  how many fields precede it. At md (2 cols) the grid
                  auto-flows them onto whatever row is next. */}
              <DatePicker
                className="fsp-search__row-start"
                datePickerType="single"
                dateFormat="Y-m-d"
                value={form.expiryDateFrom || undefined}
                onChange={(dates: Date[]) =>
                  set('expiryDateFrom', dates[0] ? toIsoDate(dates[0]) : '')
                }
              >
                <DatePickerInput
                  id="ss-expiryDateFrom"
                  placeholder="YYYY-MM-DD"
                  labelText="Expiry date from"
                />
              </DatePicker>

              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={form.expiryDateTo || undefined}
                onChange={(dates: Date[]) =>
                  set('expiryDateTo', dates[0] ? toIsoDate(dates[0]) : '')
                }
              >
                <DatePickerInput
                  id="ss-expiryDateTo"
                  placeholder="YYYY-MM-DD"
                  labelText="Expiry date to"
                />
              </DatePicker>
            </div>

            {/* Right-aligned action row matching FspSearchPage's pattern.
                Wider gap between Clear and Search than the default so the
                primary CTA stands apart from the destructive action. */}
            <div className="fsp-search__actions standards-search__actions">
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
                kind="primary"
                size="md"
                type="submit"
                disabled={loading}
                renderIcon={loading ? SearchingIcon : SearchIcon}
              >
                {loading ? 'Searching…' : 'Search'}
              </Button>
          </div>
        </form>
      </Tile>

      {/* FSP250 Standards View modal — opens on results row click.
          passiveModal renders the X close button automatically and
          drops the default primary/secondary footer (panel has its
          own edit/save controls). */}
      <Modal
        open={!!selectedRegime}
        passiveModal
        size="lg"
        className="standards-search__detail-modal"
        modalHeading={
          selectedRegime
            ? `Standards view — ${selectedRegime.regimeName || selectedRegime.regimeId}`
            : ''
        }
        onRequestClose={() => setSelectedRegime(null)}
      >
        {selectedRegime && (
          <StandardRegimeDetailPanel
            fspId=""
            amendmentNumber=""
            regimeId={selectedRegime.regimeId}
            readOnly
          />
        )}
      </Modal>

      {results !== null && (
        <div className="fsp-search__results-fullbleed">
          <div className="fsp-search__results">
            {hasResults ? (
              <>
                {/* Gray banner attached to the table top, mirroring
                    SearchPage / InboxPage treatment. */}
                <div className="fsp-search__results-header">
                  <span className="fsp-search__results-count">
                    {totalElements.toLocaleString()}{' '}
                    {totalElements === 1 ? 'standard' : 'standards'} found
                  </span>
                </div>
                <div className="fsp-search__table-container">
                  <div className="fsp-search__table">
                    <DataTable rows={results} headers={HEADERS}>
                      {({
                        rows,
                        headers,
                        getTableProps,
                        getHeaderProps,
                        getRowProps,
                      }) => (
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
                                const source = results.find((r) => r.id === row.id);
                                return (
                                  <TableRow
                                    {...getRowProps({ row })}
                                    key={row.id}
                                    className="fsp-search__row--selectable"
                                    onClick={() => source && openRegimeDetail(source)}
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
              <EmptyState
                title="No results found"
                body={
                  <>
                    No standards regimes match your search criteria.
                    <br />
                    Try adjusting your filters and searching again.
                  </>
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default StandardsSearchPage;
