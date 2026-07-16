import {
  Button,
  DataTable,
  InlineLoading,
  Pagination,
  TextInput,
  type DataTableHeader,
} from '@carbon/react';
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
  pageSize?: number;
};

const HEADERS: DataTableHeader[] = [
  { key: 'userId', header: 'User ID' },
  { key: 'displayName', header: 'Name' },
  { key: 'email', header: 'Email' },
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
    if (!normUserId && !normFirstName && !normLastName) {
      setSubmitted(null);
      setResults(null);
      return;
    }
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
      modalHeading="Find IDIR user"
      passiveModal
      size="lg"
    >
      <form className="user-search-form" onSubmit={handleSubmit}>
        <div className="user-search-form__fields">
          <TextInput
            id="user-search-user-id"
            labelText="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <TextInput
            id="user-search-first-name"
            labelText="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <TextInput
            id="user-search-last-name"
            labelText="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <Button type="submit" size="md" className="user-search-form__submit">
            Search
          </Button>
        </div>
      </form>

      {loading && (
        <div className="user-search-form__loading">
          <InlineLoading description="Searching users…" />
        </div>
      )}

      {!loading && submitted !== null && !hasResults && !error && (
        <p className="user-search-form__empty">No users matched your search.</p>
      )}

      {hasResults && (
        <DataTable
          rows={rows}
          headers={HEADERS}
          size="sm"
          render={({ rows: tableRows, headers: tableHeaders, getHeaderProps, getRowProps }) => (
            <DataTable.TableContainer>
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
                    return (
                      <DataTable.TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <DataTable.TableCell key={cell.id}>
                            {cell.info.header === 'actions' ? (
                              user ? (
                                <Button kind="ghost" size="sm" onClick={() => handleSelect(user)}>
                                  Select
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

      {shouldShowPagination && (
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

      <div className="user-search-form__actions">
        <Button kind="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
};

export default UserSearchModal;
