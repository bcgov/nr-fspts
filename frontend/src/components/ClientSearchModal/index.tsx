import {
  Button,
  ComboBox,
  DataTable,
  DataTableSkeleton,
  Loading,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { Add } from '@carbon/icons-react';
import { useCallback, useEffect, useRef, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { useAutoFocusOnOpen } from '@/hooks/useAutoFocusOnOpen';
import StatusTag from '@/components/StatusTag/StatusTag';
import {
  searchClients,
  searchClientsAuto,
  type ClientSearchResult,
} from '@/services/clientSearch';
import './ClientSearchModal.scss';

interface ClientSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the selected client when the user clicks Add on a row.
      The modal closes itself; the parent decides what to do with the row. */
  onSelect: (client: ClientSearchResult) => void;
}

const HEADERS = [
  { key: 'clientNumber', header: 'Client number' },
  { key: 'clientAcronym', header: 'Client acronym' },
  { key: 'clientName', header: 'Client name' },
  { key: 'clientLocnCode', header: 'Location code' },
  { key: 'clientLocnName', header: 'Location' },
  { key: 'city', header: 'City' },
  { key: 'clientStatusCode', header: 'Status' },
  // 'add' is a synthetic column — DataTable's row.cells iteration walks
  // the registered headers, so we surface a header for it even though
  // its cell renders an action button rather than data.
  { key: 'add', header: 'Action' },
];

const formatCell = (value: string | null | undefined) =>
  value && value.trim().length > 0 ? value.trim() : '—';

// FOREST_CLIENT.CLIENT_STATUS_CODE arrives as a short code; render the
// friendly label the rest of the UI shows (and the status pill keys on).
const CLIENT_STATUS_LABELS: Record<string, string> = {
  ACT: 'Active',
  DAC: 'Deactivated',
  DEC: 'Deceased',
  REC: 'Receivership',
  SPN: 'Suspended',
};

const clientStatusLabel = (value: string | null | undefined): string => {
  const code = value?.trim();
  if (!code) return '';
  return CLIENT_STATUS_LABELS[code.toUpperCase()] ?? code;
};

// Label for a client suggestion in the Agreement Holder autocomplete:
// "Name (ACRONYM) · #number", with absent parts dropped. Matches the
// main SearchPage's Agreement Holder combobox.
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
  // Agreement Holder autocomplete state — same shape as the main
  // SearchPage's client combobox: a debounced term drives the suggestion
  // list, and the picked client is remembered so its label stays shown.
  const [holderItems, setHolderItems] = useState<ClientSearchResult[]>([]);
  const [holderSelected, setHolderSelected] = useState<ClientSearchResult | null>(null);
  const [holderTerm, setHolderTerm] = useState('');
  // True while a valid term is being debounced/fetched for the combobox
  // suggestion list — drives the small spinner beside the field label.
  const [holderLoading, setHolderLoading] = useState(false);

  // Focus the Agreement holder combobox on open. Carbon's modal focus
  // pass doesn't reliably land on the ComboBox input, so we drive it
  // ourselves (ComboBox forwards its ref to the input).
  const holderInputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<ClientSearchResult[] | null>(null);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Errors render as a slide-in toast; `error` state stays so the
  // "no matches" empty-state gate below doesn't fire on failure.
  const { display } = useNotification();
  useEffect(() => {
    if (error) {
      display({ kind: 'error', title: 'Client search failed', subtitle: error, timeout: 5000 });
    }
  }, [error, display]);

  useAutoFocusOnOpen(holderInputRef, open);

  // Debounced Agreement Holder lookup — same shape as the main SearchPage:
  // wait 300ms after the last keystroke, skip terms under 3 chars, and
  // tolerate a failed fetch by clearing the suggestion list.
  useEffect(() => {
    const term = holderTerm.trim();
    if (term.length < 3) {
      setHolderItems([]);
      setHolderLoading(false);
      return;
    }
    // Show the spinner from the first keystroke (through the debounce and
    // the fetch); `active` guards against a stale request clearing it after
    // the term has moved on.
    let active = true;
    setHolderLoading(true);
    const handle = setTimeout(() => {
      searchClientsAuto(term)
        .then((items) => {
          if (active) setHolderItems(items);
        })
        .catch(() => {
          if (active) setHolderItems([]);
        })
        .finally(() => {
          if (active) setHolderLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [holderTerm]);

  // Pull every location row for the picked client (the autocomplete only
  // returns one row per client number). This is what fills the results
  // table the user actually picks a location from.
  const runSearch = useCallback(
    async (clientNumber: string, nextPage: number, nextSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await searchClients({ clientNumber, page: nextPage, size: nextSize });
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
    [],
  );

  // Typing replaces any prior selection and clears the results (until a
  // new client is picked). Ignore the synthetic input change Carbon fires
  // when it sets the input to the selected item's label.
  const handleHolderInput = (text: string) => {
    if (holderSelected && clientLabel(holderSelected) === text) return;
    setHolderSelected(null);
    setResults(null);
    setTotalElements(0);
    setHolderTerm(text);
  };

  // Picking a client immediately runs the location search — no separate
  // Search button. A cleared selection (the × in the combobox) empties
  // the results table.
  const handleHolderSelect = (data: { selectedItem?: ClientSearchResult | null }) => {
    const client = data.selectedItem ?? null;
    setHolderSelected(client);
    const num = client?.clientNumber?.trim();
    if (num) {
      void runSearch(num, 0, pageSize);
    } else {
      setResults(null);
      setTotalElements(0);
    }
  };

  const handlePagination = useCallback(
    ({ page: newPage, pageSize: newSize }: { page: number; pageSize: number }) => {
      const num = holderSelected?.clientNumber?.trim();
      if (num) void runSearch(num, newPage - 1, newSize);
    },
    [runSearch, holderSelected],
  );

  // Reset state every time the modal opens — otherwise a stale selection
  // and results from a previous open carry over, which is confusing when
  // the user comes back to pick a different client.
  const handleClose = useCallback(() => {
    setHolderItems([]);
    setHolderSelected(null);
    setHolderTerm('');
    setResults(null);
    setTotalElements(0);
    setPage(0);
    setError(null);
    onClose();
  }, [onClose]);

  const handleAdd = useCallback(
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
      // room for 7+ columns plus the Add button so wider is better.
      size="lg"
      modalHeading="Add agreement holder"
      passiveModal
      className="client-search-modal"
    >
      <p className="client-search__intro">
        Search for a client to add as an agreement holder on this FSP.
      </p>

      <div className="client-search__holder">
        <ComboBox
          ref={holderInputRef}
          id="client-search-holder"
          titleText={
            <span className="client-search__holder-label">
              Agreement holder
              {holderLoading && (
                <Loading
                  small
                  withOverlay={false}
                  description="Retrieving agreement holders"
                  className="client-search__holder-spinner"
                />
              )}
            </span>
          }
          helperText="Enter name, acronym, or client number (min. 3 characters)"
          items={holderItems}
          itemToString={(item) => (item ? clientLabel(item) : '')}
          selectedItem={holderSelected}
          onInputChange={handleHolderInput}
          onChange={handleHolderSelect}
        />
      </div>

      {loading && !hasResults && (
        <div className="client-search__results">
          {/* First query for a picked client — show a table skeleton in
              place of the (not-yet-loaded) results panel. */}
          <div className="bordered-table">
            <DataTableSkeleton
              headers={HEADERS}
              rowCount={5}
              showHeader={false}
              showToolbar={false}
              aria-label="Searching clients"
            />
          </div>
        </div>
      )}

      {hasResults && (
        <div className="client-search__results">
          {/* Result count banner + table + pagination read as one
              connected block inside a single rounded border, matching the
              main SearchPage results panel. */}
          <div className="bordered-table client-search__results-panel">
            <div className="client-search__results-header">
              {totalElements.toLocaleString()}{' '}
              {totalElements === 1 ? 'result' : 'results'} found
            </div>
            <div className="client-search__table-container">
              <div className={loading ? 'client-search__table--loading' : undefined}>
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
                            // the Add handler hands the parent a clean
                            // typed object rather than the DataTable's
                            // augmented row shape.
                            const original = results![idx];
                            return (
                              <TableRow key={row.id}>
                                {row.cells.map((cell) => {
                                  if (cell.info.header === 'add') {
                                    return (
                                      <TableCell key={cell.id}>
                                        <Button
                                          kind="ghost"
                                          size="sm"
                                          renderIcon={Add}
                                          onClick={() => handleAdd(original)}
                                        >
                                          Add
                                        </Button>
                                      </TableCell>
                                    );
                                  }
                                  if (cell.info.header === 'clientStatusCode') {
                                    const label = clientStatusLabel(
                                      cell.value as string | null | undefined,
                                    );
                                    return (
                                      <TableCell key={cell.id}>
                                        {label ? <StatusTag status={label} /> : '—'}
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
        </div>
      )}

      {results !== null && !hasResults && !loading && !error && (
        <p className="client-search__summary">No locations found for this client.</p>
      )}
    </Modal>
  );
};

export default ClientSearchModal;
