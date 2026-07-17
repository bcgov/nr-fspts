import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
  Loading,
  Pagination,
  TextInput,
  type DataTableHeader,
} from '@carbon/react';
import { Add, Search } from '@carbon/icons-react';
import { useCallback, useEffect, useMemo, useState, type FC, type FormEvent } from 'react';

import { Modal } from '@/components/Modal';
import { useNotification } from '@/context/notification/useNotification';
import { safeErrorMessage } from '@/lib/errorMessage';
import { searchUsers, type UserSearchParams, type UserSummary } from '@/services/fspSearch';

import './user-search-modal.scss';

type UserSearchModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (user: UserSummary) => void;
  /** District context shown as the modal's small label line above the title. */
  districtLabel?: string;
  /** Bare, UPPER-CASED IDIR usernames already designated for this district —
   *  their Add button is disabled so a user can't be added twice. */
  existingUserIds?: Set<string>;
  pageSize?: number;
};

const HEADERS: DataTableHeader[] = [
  { key: 'userId', header: 'User ID' },
  { key: 'displayName', header: 'Name' },
  { key: 'email', header: 'Email address' },
  { key: 'actions', header: 'Actions' },
];

/**
 * IDIR-lookup popup port of nr-rept's UserSearchModal. The contact-type
 * selectors that wrap REPT's caller aren't replicated here — district
 * notification has a single role for designates, so we just hand back
 * the picked UserSummary on Select.
 */
export const UserSearchModal: FC<UserSearchModalProps> = ({
  open,
  onClose,
  onSelect,
  districtLabel,
  existingUserIds,
  pageSize = 25,
}) => {
  const [userId, setUserId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitted, setSubmitted] = useState<UserSearchParams | null>(null);
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Submit-time validation message (needs ≥2 chars in a field). Shown as an
  // inline banner below the fields; cleared as soon as a field is edited.
  const [validationError, setValidationError] = useState<string | null>(null);

  const { display } = useNotification();
  useEffect(() => {
    if (error) {
      display({ kind: 'error', title: 'User search failed', subtitle: error, timeout: 7000 });
    }
  }, [error, display]);

  // Reset whenever the modal closes — picking it up clean on the next
  // open prevents stale results bleeding across district contexts.
  useEffect(() => {
    if (!open) {
      setUserId('');
      setFirstName('');
      setLastName('');
      setSubmitted(null);
      setResults(null);
      setTotal(0);
      setPage(0);
      setError(null);
      setValidationError(null);
    }
  }, [open]);

  // Re-run the search whenever the submitted criteria or page change.
  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchUsers({ ...submitted, size: pageSize })
      .then((res) => {
        if (cancelled) return;
        setResults(res.results);
        setTotal(res.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(safeErrorMessage(e));
        setResults([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submitted, page, pageSize]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normUserId = userId.trim();
    const normFirstName = firstName.trim();
    const normLastName = lastName.trim();
    // Require ≥2 chars in at least one field — an empty/1-char search would
    // return the whole directory (or nothing useful).
    const longest = Math.max(
      normUserId.length,
      normFirstName.length,
      normLastName.length,
    );
    if (longest < 2) {
      setValidationError(
        'Enter at least 2 characters in one of the fields to search.',
      );
      return;
    }
    setValidationError(null);
    setSubmitted({
      userId: normUserId || undefined,
      firstName: normFirstName || undefined,
      lastName: normLastName || undefined,
    });
    setPage(0);
  }, [userId, firstName, lastName]);

  const handleSelect = useCallback(
    (user: UserSummary) => {
      onSelect(user);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleClear = useCallback(() => {
    setUserId('');
    setFirstName('');
    setLastName('');
    setSubmitted(null);
    setResults(null);
    setTotal(0);
    setPage(0);
    setError(null);
    setValidationError(null);
  }, []);

  const rows = useMemo(() => {
    if (!results) return [];
    return results.map((u) => ({
      id: u.userId,
      user: u,
      userId: u.userId,
      displayName: u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
      email: u.email ?? '',
      actions: '',
    }));
  }, [results]);

  const hasResults = rows.length > 0;
  const shouldShowPagination = submitted !== null && total > pageSize;

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalLabel={districtLabel}
      modalHeading="Add designate"
      passiveModal
      size="lg"
      className="add-designate-modal"
    >
      <p className="user-search-form__desc">
        Search the IDIR directory for the user to add.
        <br />
        Designates receive an email when an FSP, amendment, or extension is
        submitted for this district.
      </p>

      <form className="user-search-form" onSubmit={handleSubmit}>
        <div className="user-search-form__fields">
          <TextInput
            id="user-search-user-id"
            labelText="User ID"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setValidationError(null);
            }}
          />
          <TextInput
            id="user-search-first-name"
            labelText="First name"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setValidationError(null);
            }}
          />
          <TextInput
            id="user-search-last-name"
            labelText="Last name"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setValidationError(null);
            }}
          />
        </div>

        {validationError && (
          <InlineNotification
            className="user-search-form__validation"
            kind="error"
            lowContrast
            hideCloseButton
            title={validationError}
          />
        )}

        <div className="user-search-form__search-actions">
          <Button
            kind="secondary"
            size="md"
            onClick={handleClear}
            disabled={loading}
          >
            Clear
          </Button>
          <Button
            type="submit"
            kind="primary"
            size="md"
            disabled={loading}
            renderIcon={loading ? SearchingIcon : Search}
          >
            {loading ? 'Searching' : 'Search'}
          </Button>
        </div>
      </form>

      {loading && (
        <DataTableSkeleton
          className="user-search-form__skeleton"
          headers={HEADERS}
          rowCount={4}
          showToolbar={false}
          showHeader={false}
        />
      )}

      {!loading && submitted !== null && !hasResults && !error && (
        <p className="user-search-form__empty">
          No IDIR users found. Check the spelling and try again.
        </p>
      )}

      {!loading && hasResults && (
        <DataTable
          rows={rows}
          headers={HEADERS}
          size="md"
          render={({ rows: tableRows, headers: tableHeaders, getHeaderProps, getRowProps }) => (
            <DataTable.TableContainer className="user-search-form__results">
              <DataTable.Table>
                <DataTable.TableHead>
                  <DataTable.TableRow>
                    {tableHeaders.map((header) => (
                      <DataTable.TableHeader {...getHeaderProps({ header })} key={header.key}>
                        {header.header}
                      </DataTable.TableHeader>
                    ))}
                  </DataTable.TableRow>
                </DataTable.TableHead>
                <DataTable.TableBody>
                  {tableRows.map((row) => {
                    const source = rows.find((r) => r.id === row.id);
                    const user = source?.user;
                    const alreadyDesignate =
                      !!user &&
                      (existingUserIds?.has(user.userId.trim().toUpperCase()) ??
                        false);
                    return (
                      <DataTable.TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <DataTable.TableCell key={cell.id}>
                            {cell.info.header === 'actions' ? (
                              user ? (
                                <Button
                                  kind="ghost"
                                  size="sm"
                                  renderIcon={alreadyDesignate ? undefined : Add}
                                  disabled={alreadyDesignate}
                                  onClick={() => handleSelect(user)}
                                >
                                  {alreadyDesignate ? 'Added' : 'Add'}
                                </Button>
                              ) : (
                                '—'
                              )
                            ) : (
                              (cell.value as string) || '—'
                            )}
                          </DataTable.TableCell>
                        ))}
                      </DataTable.TableRow>
                    );
                  })}
                </DataTable.TableBody>
              </DataTable.Table>
            </DataTable.TableContainer>
          )}
        />
      )}

      {!loading && shouldShowPagination && (
        <div className="user-search-form__pagination">
          <Pagination
            totalItems={total}
            pageSize={pageSize}
            page={page + 1}
            onChange={({ page: next }) => setPage(Math.max(next - 1, 0))}
            pageSizes={[pageSize]}
            size="sm"
            backwardText="Previous"
            forwardText="Next"
          />
        </div>
      )}
    </Modal>
  );
};

// Small spinner sized for the Search button's icon slot while a lookup runs.
const SearchingIcon = () => <Loading small withOverlay={false} description="" />;

export default UserSearchModal;
