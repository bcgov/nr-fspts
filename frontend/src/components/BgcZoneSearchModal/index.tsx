import {
  Button,
  DataTable,
  Loading,
  Pagination,
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
import { Search as SearchIcon } from '@carbon/icons-react';
import { useCallback, useEffect, useState, type FC, type FormEvent } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { searchBgcZones, type BgcSearchResult } from '@/services/bgcSearch';
import './BgcZoneSearchModal.scss';

interface BgcZoneSearchModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the picked BGC row when the user clicks Select. The
   * modal awaits this promise and stays open until it resolves, so the
   * parent can do an async persist (POST + re-read) without the dialog
   * vanishing before the toast appears. Throw to keep the modal open
   * for retry; the parent is responsible for surfacing the error.
   */
  onSelect: (row: BgcSearchResult) => Promise<void> | void;
}

interface CriteriaState {
  bgcZoneCode: string;
  bgcSubzoneCode: string;
  bgcVariant: string;
  bgcPhase: string;
}

const EMPTY_CRITERIA: CriteriaState = {
  bgcZoneCode: '',
  bgcSubzoneCode: '',
  bgcVariant: '',
  bgcPhase: '',
};

// Column max-lengths from STANDARDS_REGIME_SITE_SERIES (matches the
// values the user can ultimately save back into an FSP row).
const FIELD_LENGTHS = {
  bgcZoneCode: 4,
  bgcSubzoneCode: 3,
  bgcVariant: 1,
  bgcPhase: 1,
} as const;

const HEADERS = [
  { key: 'bgcZoneCode', header: 'Zone' },
  { key: 'bgcSubzoneCode', header: 'Subzone' },
  { key: 'bgcVariant', header: 'Variant' },
  { key: 'bgcPhase', header: 'Phase' },
  { key: 'becSiteSeriesCd', header: 'Site series' },
  { key: 'becSiteSeriesPhaseCd', header: 'Site series phase' },
  { key: 'becSeral', header: 'Seral' },
  { key: 'siteSeriesDesc', header: 'Description' },
  // Synthetic action column. DataTable iterates row.cells over the
  // registered headers, so we surface a header for the Select button.
  { key: 'select', header: '' },
];

const formatCell = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

// Composite key — site series rows share the same BGC quadruple,
// so we include all seven fields. Suffix with index to defend against
// non-unique combinations on the cursor side.
const rowKey = (r: BgcSearchResult, index: number): string =>
  [
    r.bgcZoneCode,
    r.bgcSubzoneCode,
    r.bgcVariant,
    r.bgcPhase,
    r.becSiteSeriesCd,
    r.becSiteSeriesPhaseCd,
    r.becSeral,
  ]
    .map((v) => v ?? '')
    .concat(String(index))
    .join('-');

const BgcZoneSearchModal: FC<BgcZoneSearchModalProps> = ({ open, onClose, onSelect }) => {
  const [criteria, setCriteria] = useState<CriteriaState>(EMPTY_CRITERIA);
  const [results, setResults] = useState<BgcSearchResult[] | null>(null);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Row currently being persisted via onSelect. Stable per-row key so
  // we can show the spinner on the right Select button and only disable
  // *other* rows' buttons (rather than freezing the whole table).
  const [selectingKey, setSelectingKey] = useState<string | null>(null);

  // Errors surface as a slide-in toast; `error` state stays so the
  // "no matches" empty-state gate below doesn't fire on failure.
  const { display } = useNotification();
  useEffect(() => {
    if (error) {
      display({
        kind: 'error',
        title: 'BGC zone search failed',
        subtitle: error,
        timeout: 5000,
      });
    }
  }, [error, display]);

  const set = <K extends keyof CriteriaState>(key: K, value: CriteriaState[K]) =>
    setCriteria((prev) => ({ ...prev, [key]: value }));

  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchBgcZones({
          bgcZoneCode: criteria.bgcZoneCode,
          bgcSubzoneCode: criteria.bgcSubzoneCode,
          bgcVariant: criteria.bgcVariant,
          bgcPhase: criteria.bgcPhase,
          page: nextPage,
          size: nextSize,
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
    [criteria],
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

  // Reset state every time the modal opens — otherwise stale criteria
  // and results from a previous open carry over, which is confusing
  // when the user comes back to pick a different BGC zone.
  const handleClose = useCallback(() => {
    // Block manual close while a save is in flight so the user can't
    // dismiss the dialog mid-request and miss the result.
    if (selectingKey) return;
    setCriteria(EMPTY_CRITERIA);
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
    onClose();
  }, [onClose, selectingKey]);

  const handleSelect = useCallback(
    async (key: string, row: BgcSearchResult) => {
      if (selectingKey) return;
      setSelectingKey(key);
      try {
        await onSelect(row);
        // Success — wipe state then close. Don't gate this on
        // selectingKey (we just cleared the in-flight marker), so call
        // onClose directly rather than going through handleClose.
        setSelectingKey(null);
        setCriteria(EMPTY_CRITERIA);
        setResults(null);
        setTotalElements(0);
        setPage(0);
        setError(null);
        onClose();
      } catch {
        // Parent surfaces its own error toast; keep the modal open so
        // the user can pick again (or fix criteria and retry).
        setSelectingKey(null);
      }
    },
    [onSelect, onClose, selectingKey],
  );

  const hasResults = results !== null && results.length > 0;

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      // Carbon "lg" — the results table is 7 visible columns plus the
      // Select button so wider is better.
      size="lg"
      modalHeading="BGC zone search"
      passiveModal
      className="bgc-search-modal"
    >
      <form className="bgc-search__form" onSubmit={handleSubmit}>
        <div className="bgc-search__field-grid">
          <TextInput
            id="bgc-search-zone"
            labelText="Zone"
            value={criteria.bgcZoneCode}
            onChange={(e) => set('bgcZoneCode', e.target.value.toUpperCase())}
            maxLength={FIELD_LENGTHS.bgcZoneCode}
            autoComplete="off"
          />
          <TextInput
            id="bgc-search-subzone"
            labelText="Subzone"
            value={criteria.bgcSubzoneCode}
            onChange={(e) => set('bgcSubzoneCode', e.target.value.toLowerCase())}
            maxLength={FIELD_LENGTHS.bgcSubzoneCode}
            autoComplete="off"
          />
          <TextInput
            id="bgc-search-variant"
            labelText="Variant"
            value={criteria.bgcVariant}
            onChange={(e) => set('bgcVariant', e.target.value)}
            maxLength={FIELD_LENGTHS.bgcVariant}
            autoComplete="off"
          />
          <TextInput
            id="bgc-search-phase"
            labelText="Phase"
            value={criteria.bgcPhase}
            onChange={(e) => set('bgcPhase', e.target.value.toLowerCase())}
            maxLength={FIELD_LENGTHS.bgcPhase}
            autoComplete="off"
          />
        </div>

        <div className="bgc-search__actions">
          <Button
            type="submit"
            size="md"
            renderIcon={loading ? SearchingIcon : SearchIcon}
            disabled={loading}
          >
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </form>

      {hasResults && (
        <div className="bgc-search__results">
          <div className="bgc-search__table-container">
            <div className={loading ? 'bgc-search__table--loading' : undefined}>
              <div className="bordered-table">
                <DataTable
                  rows={results!.map((r, i) => ({ ...r, id: rowKey(r, i) }))}
                  headers={HEADERS}
                >
                  {({ rows, headers, getTableProps, getHeaderProps }) => (
                    <TableContainer>
                      <Table {...getTableProps()} size="sm" useZebraStyles>
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
                          {rows.map((row, idx) => {
                            // Pull the original record back so the
                            // Select handler hands the parent a clean
                            // typed object rather than DataTable's
                            // augmented row shape.
                            const original = results![idx];
                            const isSelecting = selectingKey === row.id;
                            const otherBusy =
                              selectingKey !== null && !isSelecting;
                            return (
                              <TableRow key={row.id}>
                                {row.cells.map((cell) => {
                                  if (cell.info.header === 'select') {
                                    return (
                                      <TableCell key={cell.id}>
                                        <Button
                                          kind="ghost"
                                          size="sm"
                                          disabled={isSelecting || otherBusy}
                                          renderIcon={
                                            isSelecting ? SearchingIcon : undefined
                                          }
                                          onClick={() =>
                                            void handleSelect(row.id, original)
                                          }
                                        >
                                          {isSelecting ? 'Saving…' : 'Select'}
                                        </Button>
                                      </TableCell>
                                    );
                                  }
                                  return (
                                    <TableCell key={cell.id}>
                                      {formatCell(cell.value as string | null | undefined)}
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
              <div className="bgc-search__table-overlay" role="status" aria-live="polite">
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
        </div>
      )}

      {results !== null && !hasResults && !error && (
        <p className="bgc-search__summary">No BGC zones match your search.</p>
      )}
    </Modal>
  );
};

// Small Carbon spinner sized to fit the Button icon slot; same shape
// the SearchPage and ClientSearchModal use.
const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

export default BgcZoneSearchModal;
