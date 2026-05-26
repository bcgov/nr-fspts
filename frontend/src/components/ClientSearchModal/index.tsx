import {
  Button,
  DataTable,
  InlineNotification,
  Loading,
  Modal,
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
import { Search as SearchIcon } from '@carbon/icons-react';
import { useCallback, useState, type FC, type FormEvent } from 'react';

import { searchClients, type ClientSearchResult } from '@/services/clientSearch';
import './ClientSearchModal.scss';

interface ClientSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the selected client when the user clicks Select on a row.
      The modal closes itself; the parent decides what to do with the row. */
  onSelect: (client: ClientSearchResult) => void;
}

interface CriteriaState {
  clientAcronym: string;
  clientNumber: string;
  clientName: string; // last name
  legalFirstName: string;
  legalMiddleName: string;
}

const EMPTY_CRITERIA: CriteriaState = {
  clientAcronym: '',
  clientNumber: '',
  clientName: '',
  legalFirstName: '',
  legalMiddleName: '',
};

// Column max-lengths sourced from THE.FOREST_CLIENT — see the
// reference_fsp-schema-lengths memory note. Last Name in the DB is
// VARCHAR2(60) but the legacy SIL21 form capped it at 30 for the
// same reason most search forms do: matching by prefix is cheaper
// and 30 chars covers ~all real surnames.
const FIELD_LENGTHS = {
  clientAcronym: 8,
  clientNumber: 8,
  clientName: 30,
  legalFirstName: 30,
  legalMiddleName: 30,
} as const;

const HEADERS = [
  { key: 'clientAcronym', header: 'Client Acronym' },
  { key: 'clientNumber', header: 'Client Number' },
  { key: 'clientLocnCode', header: 'Location Code' },
  { key: 'clientName', header: 'Client Name' },
  { key: 'clientLocnName', header: 'Location' },
  { key: 'city', header: 'City' },
  { key: 'clientStatusCode', header: 'Status' },
  // 'select' is a synthetic column — DataTable's row.cells iteration
  // walks the registered headers, so we surface a header for it even
  // though its cell renders an action button rather than data.
  { key: 'select', header: '' },
];

const formatCell = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

// Each row needs a unique id. clientNumber + locnCode is unique per
// row in the cursor (a client may have multiple locations); if either
// is missing we fall back to the row index.
const rowKey = (r: ClientSearchResult, index: number): string => {
  const num = r.clientNumber?.trim();
  const loc = r.clientLocnCode?.trim();
  if (num && loc) return `${num}-${loc}`;
  if (num) return `${num}-${index}`;
  return `row-${index}`;
};

const ClientSearchModal: FC<ClientSearchModalProps> = ({ open, onClose, onSelect }) => {
  const [criteria, setCriteria] = useState<CriteriaState>(EMPTY_CRITERIA);
  const [results, setResults] = useState<ClientSearchResult[] | null>(null);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CriteriaState>(key: K, value: CriteriaState[K]) =>
    setCriteria((prev) => ({ ...prev, [key]: value }));

  // Acronym + Client Number are alphanumeric in the DB (Acronym mostly
  // letters, Number is padded digits) — strip pure-whitespace-only
  // input but allow whatever else the user types. The proc's LIKE
  // searches do the heavy lifting for fuzzy matching.

  const runSearch = useCallback(
    async (nextPage: number, nextSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchClients({
          clientAcronym: criteria.clientAcronym,
          clientNumber: criteria.clientNumber,
          clientName: criteria.clientName,
          legalFirstName: criteria.legalFirstName,
          legalMiddleName: criteria.legalMiddleName,
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
  // when the user comes back to pick a different client.
  const handleClose = useCallback(() => {
    setCriteria(EMPTY_CRITERIA);
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
    onClose();
  }, [onClose]);

  const handleSelect = useCallback(
    (row: ClientSearchResult) => {
      onSelect(row);
      handleClose();
    },
    [onSelect, handleClose],
  );

  const hasResults = results !== null && results.length > 0;

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      // Carbon's "lg" passes the standard breakpoint; the table needs
      // room for 7+ columns plus the Select button so wider is better.
      size="lg"
      modalHeading="Client Search"
      passiveModal
      className="client-search-modal"
    >
      <form className="client-search__form" onSubmit={handleSubmit}>
        <div className="client-search__field-grid">
          <TextInput
            id="client-search-acronym"
            labelText="Client Acronym"
            value={criteria.clientAcronym}
            onChange={(e) => set('clientAcronym', e.target.value)}
            maxLength={FIELD_LENGTHS.clientAcronym}
            autoComplete="off"
          />
          <TextInput
            id="client-search-number"
            labelText="Client Number"
            value={criteria.clientNumber}
            onChange={(e) => set('clientNumber', e.target.value.replace(/\D/g, ''))}
            maxLength={FIELD_LENGTHS.clientNumber}
            inputMode="numeric"
            autoComplete="off"
          />
          <TextInput
            id="client-search-lastName"
            labelText="Last Name"
            value={criteria.clientName}
            onChange={(e) => set('clientName', e.target.value)}
            maxLength={FIELD_LENGTHS.clientName}
            autoComplete="off"
          />
          <TextInput
            id="client-search-firstName"
            labelText="First Name"
            value={criteria.legalFirstName}
            onChange={(e) => set('legalFirstName', e.target.value)}
            maxLength={FIELD_LENGTHS.legalFirstName}
            autoComplete="off"
          />
          <TextInput
            id="client-search-middleName"
            labelText="Middle Name"
            value={criteria.legalMiddleName}
            onChange={(e) => set('legalMiddleName', e.target.value)}
            maxLength={FIELD_LENGTHS.legalMiddleName}
            autoComplete="off"
          />
        </div>

        <div className="client-search__actions">
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

      {error && (
        <InlineNotification
          kind="error"
          title="Client search failed"
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      )}

      {hasResults && (
        <div className="client-search__results">
          <div className="client-search__table-container">
            <div className={loading ? 'client-search__table--loading' : undefined}>
              <div className="bordered-table">
                <DataTable rows={results!.map((r, i) => ({ ...r, id: rowKey(r, i) }))} headers={HEADERS}>
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
                            // Pull the original ClientSearchResult back so
                            // the Select handler hands the parent a clean
                            // typed object rather than the DataTable's
                            // augmented row shape.
                            const original = results![idx];
                            return (
                              <TableRow key={row.id}>
                                {row.cells.map((cell) => {
                                  if (cell.info.header === 'select') {
                                    return (
                                      <TableCell key={cell.id}>
                                        <Button
                                          kind="ghost"
                                          size="sm"
                                          onClick={() => handleSelect(original)}
                                        >
                                          Select
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
              <div className="client-search__table-overlay" role="status" aria-live="polite">
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
        <p className="client-search__summary">No clients match your search.</p>
      )}
    </Modal>
  );
};

// Renders a small Carbon spinner sized to fit a Button icon slot;
// same shape we use on the main SearchPage's Search button.
const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

export default ClientSearchModal;
