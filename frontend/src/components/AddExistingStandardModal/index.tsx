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
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import { Add, Copy, Information, Search as SearchIcon } from '@carbon/icons-react';
import {
  type FC,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { useNotification } from '@/context/notification/useNotification';
import {
  type CodeOption,
  copyStandardRegime,
  getOrgUnits,
  getSilvTreeSpeciesCodes,
  linkDefaultStandard,
} from '@/services/fspSearch';
import {
  searchStandards,
  type StandardsSearchResult,
} from '@/services/standardsSearch';
import './AddExistingStandardModal.scss';

interface Props {
  open: boolean;
  fspId: string;
  amendmentNumber: string;
  onClose: () => void;
  /**
   * Called with the new regime's id after a successful copy. The
   * parent typically refetches the standards list and selects the
   * fresh row so the user lands on the just-added standard.
   */
  onAdded: (newRegimeId: string) => void;
}

const DEFAULT_STANDARD_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'Y', label: 'Yes' },
  { value: 'N', label: 'No' },
];

interface StatusOption {
  code: string;
  description: string;
}

// Same six values FSP501's screen surfaces — sourced from
// std_regime_status_code legacy lookup. Hard-coded here for parity
// with the standalone StandardsSearchPage; a dedicated endpoint can
// replace this when the lookup proc lands in the new backend.
const STATUS_OPTIONS: StatusOption[] = [
  { code: 'APP', description: 'Approved' },
  { code: 'DFT', description: 'Draft' },
  { code: 'SUB', description: 'Submitted' },
  { code: 'RPL', description: 'Replaced' },
  { code: 'RJT', description: 'Rejected' },
  { code: 'EXP', description: 'Expired' },
];

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
  /** MoF default standard → offer Add(link); otherwise Copy only. */
  isDefault: boolean;
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
  // Trailing actions column — per-row Add button. Empty header text.
  { key: 'actions', header: '', isSortable: false },
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

const DEFAULT_PAGE_SIZE = 10;
const SORT_BY = 'standardsRegimeId';
const SORT_DIR: 'asc' = 'asc';

const formatCellText = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

const toIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

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
  expiryDate: r.expiryDate ?? '',
  fspIdList: r.fspIdList ?? '',
  isDefault: r.mofDefaultStandardInd === 'Y',
});

/**
 * Standards-search picker that lives over the FSP Information page's
 * Stocking Standards tab. Same form criteria as the standalone
 * Stocking Standards Search page; the per-row "Add" button copies
 * the chosen regime onto the current FSP via
 * {@code FSP_550_STDS_PROPOSAL.COPY} (the same proc the existing Copy
 * Standard button uses — legacy FSP501's "Add to FSP" path).
 */
const AddExistingStandardModal: FC<Props> = ({
  open,
  fspId,
  amendmentNumber,
  onClose,
  onAdded,
}) => {
  const { display } = useNotification();

  const [form, setForm] = useState<SearchForm>(EMPTY_FORM);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  // Which row is being acted on + whether it's a link (Add) or a copy.
  const [busy, setBusy] = useState<{ id: string; kind: 'link' | 'copy' } | null>(
    null,
  );

  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [speciesCodes, setSpeciesCodes] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);

  // Load code lists once on first open. Inside the modal so that
  // closing + reopening keeps the cached values without re-fetching.
  useEffect(() => {
    if (!open || (orgUnits.length > 0 && speciesCodes.length > 0)) return;
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
  }, [open, orgUnits.length, speciesCodes.length]);

  // Reset transient state on close so the next open starts with a
  // clean slate (form persists across opens — most users repeat a
  // similar search; results / pagination do not).
  useEffect(() => {
    if (!open) {
      setResults(null);
      setTotalElements(0);
      setPage(0);
      setPageSize(DEFAULT_PAGE_SIZE);
      setBusy(null);
    }
  }, [open]);

  const set = <K extends keyof SearchForm>(key: K, value: SearchForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setDigitsOnly = <K extends keyof SearchForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, e.target.value.replace(/\D/g, '') as SearchForm[K]);

  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      if (form.expiryDateFrom && form.expiryDateTo
          && form.expiryDateFrom > form.expiryDateTo) {
        display({
          kind: 'error',
          title: 'Invalid date range',
          subtitle: 'Expiry Date From must be on or before Expiry Date To.',
          timeout: 5000,
        });
        setResults([]);
        setTotalElements(0);
        return;
      }
      setLoading(true);
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
        display({
          kind: 'error',
          title: 'Standards search failed',
          subtitle: e instanceof Error ? e.message : String(e),
          timeout: 6000,
        });
        setResults([]);
        setTotalElements(0);
      } finally {
        setLoading(false);
      }
    },
    [form, display],
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
  }, []);

  // "Add" — LINK a shared MoF default standard onto the FSP (no copy). Only
  // offered for default standards. Mirrors legacy's Add Default Standard.
  const handleLink = async (regimeId: string) => {
    if (!regimeId || busy) return;
    setBusy({ id: regimeId, kind: 'link' });
    try {
      const linked = await linkDefaultStandard(fspId, regimeId, amendmentNumber);
      const newId = linked.standardsRegimeId ?? regimeId;
      display({
        kind: 'success',
        title: 'Default standard added.',
        subtitle: `Linked standard ${newId} to this FSP.`,
        timeout: 5000,
      });
      onAdded(newId);
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to add default standard',
        subtitle: e instanceof Error ? e.message : String(e),
        timeout: 8000,
      });
    } finally {
      setBusy(null);
    }
  };

  // "Copy" — clone a standard into a new editable Draft on this FSP.
  const handleCopy = async (regimeId: string) => {
    if (!regimeId || busy) return;
    setBusy({ id: regimeId, kind: 'copy' });
    try {
      const created = await copyStandardRegime(fspId, regimeId, amendmentNumber);
      const newId = created.standardsRegimeId ?? regimeId;
      display({
        kind: 'success',
        title: 'Stocking standard copied.',
        subtitle: `Copied as draft regime ${newId}.`,
        timeout: 5000,
      });
      onAdded(newId);
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to copy standard',
        subtitle: e instanceof Error ? e.message : String(e),
        timeout: 8000,
      });
    } finally {
      setBusy(null);
    }
  };

  if (codeListsLoading && open) {
    return (
      <Modal
        open={open}
        passiveModal
        size="lg"
        className="add-std-modal"
        modalHeading="Add existing stocking standard"
        onRequestClose={onClose}
      >
        <div className="add-std-modal__loading" role="status" aria-live="polite">
          <Loading description="Loading…" withOverlay={false} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      passiveModal
      size="lg"
      className="add-std-modal"
      modalHeading="Add existing stocking standard"
      onRequestClose={onClose}
      preventCloseOnClickOutside
    >
      <p className="add-std-modal__intro">
        Search for an existing standards regime, then add it to this FSP.
      </p>

      <form className="add-std-modal__form" onSubmit={handleSubmit}>
        <div className="add-std-modal__field-grid">
          <Select
            id="add-std-defaultStandard"
            labelText="Default standards"
            value={form.defaultStandard}
            onChange={(e) => set('defaultStandard', e.target.value)}
          >
            {DEFAULT_STANDARD_OPTIONS.map((o) => (
              <SelectItem key={o.value || 'any'} value={o.value} text={o.label} />
            ))}
          </Select>

          <Select
            id="add-std-statusCode"
            labelText="Regime status"
            value={form.statusCode}
            onChange={(e) => set('statusCode', e.target.value)}
          >
            <SelectItem value="" text="All statuses" />
            {STATUS_OPTIONS.map((o) => (
              <SelectItem
                key={o.code}
                value={o.code}
                text={o.description || o.code}
              />
            ))}
          </Select>

          <Select
            id="add-std-orgUnitNo"
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
            id="add-std-fspId"
            labelText="FSP ID"
            value={form.fspId}
            onChange={setDigitsOnly('fspId')}
            maxLength={10}
            inputMode="numeric"
            autoComplete="off"
          />

          <TextInput
            id="add-std-clientNumber"
            labelText="Client number"
            value={form.clientNumber}
            onChange={setDigitsOnly('clientNumber')}
            maxLength={8}
            inputMode="numeric"
            autoComplete="off"
          />

          <TextInput
            id="add-std-clientName"
            labelText="Client name"
            value={form.clientName}
            onChange={(e) => set('clientName', e.target.value)}
            maxLength={60}
          />

          <TextInput
            id="add-std-standardsRegimeId"
            labelText="Standards ID"
            value={form.standardsRegimeId}
            onChange={setDigitsOnly('standardsRegimeId')}
            maxLength={10}
            inputMode="numeric"
            autoComplete="off"
          />

          <TextInput
            id="add-std-standardsRegimeName"
            labelText="Standards name"
            value={form.standardsRegimeName}
            onChange={(e) => set('standardsRegimeName', e.target.value)}
            maxLength={50}
          />

          <TextInput
            id="add-std-standardsObjective"
            labelText="Objective"
            value={form.standardsObjective}
            onChange={(e) => set('standardsObjective', e.target.value)}
            maxLength={50}
          />

          <Select
            id="add-std-preferredSpecies"
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
            id="add-std-acceptableSpecies"
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

          <DatePicker
            datePickerType="single"
            dateFormat="Y-m-d"
            value={form.expiryDateFrom || undefined}
            onChange={(dates: Date[]) =>
              set('expiryDateFrom', dates[0] ? toIsoDate(dates[0]) : '')
            }
          >
            <DatePickerInput
              id="add-std-expiryDateFrom"
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
              id="add-std-expiryDateTo"
              placeholder="YYYY-MM-DD"
              labelText="Expiry date to"
            />
          </DatePicker>
        </div>

        <div className="add-std-modal__actions">
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

      {results !== null && (
        <div className="add-std-modal__results">
          {results.length === 0 ? (
            <p className="add-std-modal__empty">
              No standards regimes matched. Adjust your search criteria
              and try again.
            </p>
          ) : (
            <>
              <div className="add-std-modal__banner" role="note">
                <Information className="add-std-modal__banner-icon" size={20} />
                <span>
                  The selected regime is copied onto the FSP as a new Draft —
                  the original is left untouched.
                </span>
              </div>
              <div className="add-std-modal__results-header">
                {totalElements.toLocaleString()}{' '}
                {totalElements === 1 ? 'standard' : 'standards'} found
              </div>
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
                          const regimeId =
                            (row.cells.find(
                              (c) => c.info.header === 'standardsRegimeId',
                            )?.value as string | undefined) ?? '';
                          // Default standards can be Added (linked) or Copied;
                          // non-default standards can only be Copied (legacy parity).
                          const isDefault =
                            (results ?? []).find((r) => r.id === row.id)?.isDefault ??
                            false;
                          const anyBusy = busy !== null;
                          const busyHere = busy?.id === regimeId;
                          return (
                            <TableRow {...getRowProps({ row })} key={row.id}>
                              {row.cells.map((cell) => {
                                const value = cell.value as string | null | undefined;
                                if (cell.info.header === 'actions') {
                                  return (
                                    <TableCell key={cell.id}>
                                      <div className="add-std-modal__row-actions">
                                        {isDefault && (
                                          <Button
                                            kind="ghost"
                                            size="sm"
                                            renderIcon={
                                              busyHere && busy?.kind === 'link'
                                                ? SearchingIcon
                                                : Add
                                            }
                                            onClick={() => void handleLink(regimeId)}
                                            disabled={!regimeId || anyBusy}
                                          >
                                            {busyHere && busy?.kind === 'link'
                                              ? 'Adding…'
                                              : 'Add'}
                                          </Button>
                                        )}
                                        <Button
                                          kind="ghost"
                                          size="sm"
                                          renderIcon={
                                            busyHere && busy?.kind === 'copy'
                                              ? SearchingIcon
                                              : Copy
                                          }
                                          onClick={() => void handleCopy(regimeId)}
                                          disabled={!regimeId || anyBusy}
                                        >
                                          {busyHere && busy?.kind === 'copy'
                                            ? 'Copying…'
                                            : 'Copy'}
                                        </Button>
                                      </div>
                                    </TableCell>
                                  );
                                }
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
        </div>
      )}
    </Modal>
  );
};

const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

export default AddExistingStandardModal;
