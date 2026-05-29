import {
  Button,
  Column,
  DataTable,
  Grid,
  Loading,
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
  Tile,
} from '@carbon/react';
import { TrashCan } from '@carbon/icons-react';
import { useCallback, useEffect, useRef, useState, type FC } from 'react';

import { DestructiveModal } from '@/components/core/DestructiveModal';
import { UserSearchModal } from '@/components/UserSearchModal';
import { useNotification } from '@/context/notification/useNotification';
import {
  addDistrictDesignate,
  getDistrictDesignates,
  getOrgUnits,
  removeDistrictDesignate,
  searchUsers,
  type CodeOption,
  type NotificationDesignate,
  type UserSummary,
} from '@/services/fspSearch';

// Designate IDIRs are stored with the AD prefix ("IDIR\MAVILLEN"); FAM
// expects the bare name. Strip whatever sits ahead of the last backslash.
const stripIdirPrefix = (idir: string): string => {
  const idx = idir.lastIndexOf('\\');
  return idx >= 0 ? idir.slice(idx + 1) : idir;
};

import './DistrictNotificationPage.scss';

const HEADERS = [
  { key: 'designateIdir', header: 'IDIR Username' },
  { key: 'displayName', header: 'Display Name' },
  { key: 'emailAddress', header: 'E-mail Address' },
  { key: 'actions', header: '' },
];

const formatCellText = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const DistrictNotificationPage: FC = () => {
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);

  // Form state — only the district matters; designate IDIR comes
  // entirely from the FAM user-search modal pick.
  const [orgUnitNo, setOrgUnitNo] = useState('');

  // Results state — null = no query yet, [] = queried but empty.
  const [designates, setDesignates] = useState<NotificationDesignate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Pending-deletion target. When non-null the DestructiveModal renders
  // open with that designate's IDIR username in the confirmation text;
  // hitting Cancel sets it back to null without firing the API call.
  const [pendingDelete, setPendingDelete] = useState<NotificationDesignate | null>(null);
  // FAM IDIR lookup popup state. The "Find user" button opens it; on
  // Select the picked user's userId flows into newIdir so Add reuses
  // the same SAVE path as the previous manual-entry flow.
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Errors render as a slide-in toast (top-right corner). `error` state
  // is kept so the empty-state gate below ("No designates yet") doesn't
  // show alongside a failure.
  const { display } = useNotification();
  useEffect(() => {
    if (error) {
      display({ kind: 'error', title: 'Error', subtitle: error, timeout: 5000 });
    }
  }, [error, display]);

  // Code list bootstrap — same pattern as Inbox/Search. Don't render
  // the form until org units land so the user never sees an empty
  // dropdown.
  useEffect(() => {
    let cancelled = false;
    getOrgUnits()
      .then((rows) => {
        if (!cancelled) setOrgUnits(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load org units.');
        }
      })
      .finally(() => {
        if (!cancelled) setCodeListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Background enrichment is gated on the request's orgUnit matching
  // the user's *current* selection — switching districts mid-flight
  // would otherwise paint stale profiles onto the next district's list.
  const enrichmentOrgUnitRef = useRef<string | null>(null);

  const loadDesignates = useCallback(async (orgUnit: string) => {
    setLoading(true);
    setError(null);
    enrichmentOrgUnitRef.current = orgUnit;
    try {
      const rows = await getDistrictDesignates(orgUnit);
      setDesignates(rows);
      // Kick off FAM profile lookups in the background. The list is
      // already visible at this point; displayName/email cells render
      // as "—" until the lookups resolve.
      if (rows.length > 0) {
        void enrichDesignates(orgUnit, rows);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load designates.');
      setDesignates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetches each row's FAM profile in parallel, then merges the
  // displayName + email back into state in a single update. Bails if
  // the user picked a different district while the lookups were in
  // flight (enrichmentOrgUnitRef guards against stale painting).
  const enrichDesignates = useCallback(
    async (orgUnit: string, rows: NotificationDesignate[]) => {
      const lookups = await Promise.allSettled(
        rows.map((row) =>
          searchUsers({ userId: stripIdirPrefix(row.designateIdir), size: 1 }).then(
            (resp) => ({ idir: row.designateIdir, profile: resp.results[0] ?? null }),
          ),
        ),
      );
      if (enrichmentOrgUnitRef.current !== orgUnit) return;
      const profileByIdir = new Map<string, UserSummary>();
      for (const result of lookups) {
        if (result.status === 'fulfilled' && result.value.profile) {
          profileByIdir.set(result.value.idir, result.value.profile);
        }
      }
      setDesignates((current) => {
        if (!current) return current;
        return current.map((row) => {
          const profile = profileByIdir.get(row.designateIdir);
          if (!profile) return row;
          return {
            ...row,
            displayName: profile.displayName ?? row.displayName ?? null,
            emailAddress: profile.email ?? row.emailAddress ?? null,
          };
        });
      });
    },
    [],
  );

  // Picking a district fires the load directly — no Search button. Reverting
  // to the placeholder ("") clears the table and any in-flight enrichment.
  const handleDistrictChange = useCallback(
    (next: string) => {
      setOrgUnitNo(next);
      setError(null);
      if (next) {
        void loadDesignates(next);
      } else {
        setDesignates(null);
        enrichmentOrgUnitRef.current = null;
      }
    },
    [loadDesignates],
  );

  // FAM user-picker callback. Selecting a row in the user-search modal
  // is the entire "add a designate" gesture — there's no intermediate
  // text input or separate "Add" button. The picked userId goes
  // straight to the SAVE endpoint; on success we reload the table.
  const handleUserPicked = useCallback(
    async (user: UserSummary) => {
      if (!orgUnitNo) {
        setError('Select a district first.');
        return;
      }
      setAdding(true);
      setError(null);
      try {
        await addDistrictDesignate(orgUnitNo, user.userId);
        await loadDesignates(orgUnitNo);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add designate.');
      } finally {
        setAdding(false);
      }
    },
    [orgUnitNo, loadDesignates],
  );

  // The trash-can in the table just queues a designate for deletion;
  // confirmDelete is what actually hits the backend, gated by the
  // DestructiveModal below.
  const requestDelete = useCallback((designate: NotificationDesignate) => {
    setPendingDelete(designate);
  }, []);

  const cancelDelete = useCallback(() => {
    if (removingId) return; // don't allow Cancel while a delete is in flight
    setPendingDelete(null);
  }, [removingId]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete?.designateId) {
      setPendingDelete(null);
      return;
    }
    const targetId = pendingDelete.designateId;
    setRemovingId(targetId);
    setError(null);
    try {
      await removeDistrictDesignate(targetId);
      setPendingDelete(null);
      await loadDesignates(orgUnitNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove designate.');
    } finally {
      setRemovingId(null);
    }
  }, [pendingDelete, orgUnitNo, loadDesignates]);

  if (codeListsLoading) {
    return (
      <div className="fsp-district__loading" role="status" aria-live="polite">
        <Loading description="Loading…" withOverlay={false} />
      </div>
    );
  }

  // Map service rows to DataTable rows — give each row a stable id
  // (designateId is server-assigned and unique).
  const tableRows =
    designates?.map((d, idx) => ({
      id: d.designateId ?? `row-${idx}`,
      designateIdir: d.designateIdir ?? '',
      displayName: d.displayName ?? '',
      emailAddress: d.emailAddress ?? '',
      actions: '',
      __designateId: d.designateId,
    })) ?? [];

  const hasResults = designates !== null && designates.length > 0;

  return (
    <>
    <Grid fullWidth className="default-grid fsp-district-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-district__header">
          <h1>District Notification</h1>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <Tile className="fsp-district__tile">
            <div className="fsp-district__form">
              <div className="fsp-district__form-col">
                <Select
                  id="district-orgUnit"
                  labelText="District"
                  value={orgUnitNo}
                  onChange={(e) => handleDistrictChange(e.target.value)}
                  disabled={loading}
                >
                  <SelectItem value="" text="Select a district" />
                  {orgUnits.map((o) => (
                    <SelectItem key={o.code} value={o.code} text={o.description} />
                  ))}
                </Select>
              </div>
            </div>

            {designates !== null && !error && (
              <Stack gap={5}>
                {/* Add-designate trigger, right-aligned. Clicking
                    opens the FAM user-search modal; picking a user
                    there is the entire add gesture (handleUserPicked
                    fires SAVE directly, no separate Add button). */}
                <div className="fsp-district__add-row">
                  <Button
                    className="fsp-district__add-trigger"
                    kind="primary"
                    size="md"
                    onClick={() => setUserSearchOpen(true)}
                    disabled={adding || loading}
                  >
                    {adding ? 'Saving…' : 'Add user…'}
                  </Button>
                </div>

                {hasResults && (
                  <div className="fsp-district__table-container">
                    <div className={loading ? 'fsp-district__table--loading' : undefined}>
                      <div className="bordered-table">
                        <DataTable rows={tableRows} headers={HEADERS}>
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
                                  {rows.map((row) => {
                                    // designateId isn't a column we
                                    // render, so Carbon's row.cells
                                    // doesn't carry it — look it up in
                                    // the source list by row.id, which
                                    // we built from designateId above.
                                    const source = tableRows.find((r) => r.id === row.id);
                                    const designateId = source?.__designateId ?? null;
                                    const designate = designates?.find(
                                      (d) => d.designateId === designateId,
                                    );
                                    const isRemoving = removingId === designateId;
                                    return (
                                      <TableRow {...getRowProps({ row })} key={row.id}>
                                        {row.cells.map((cell) => {
                                          if (cell.info.header === 'actions') {
                                            return (
                                              <TableCell key={cell.id}>
                                                {designate ? (
                                                  <Button
                                                    className="fsp-district__delete-btn"
                                                    kind="danger--ghost"
                                                    size="sm"
                                                    renderIcon={TrashCan}
                                                    iconDescription={
                                                      isRemoving ? 'Removing…' : 'Remove'
                                                    }
                                                    hasIconOnly
                                                    onClick={() => requestDelete(designate)}
                                                    disabled={isRemoving || loading}
                                                  />
                                                ) : null}
                                              </TableCell>
                                            );
                                          }
                                          return (
                                            <TableCell key={cell.id}>
                                              {formatCellText(cell.value as string)}
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
                      <div
                        className="fsp-district__table-overlay"
                        role="status"
                        aria-live="polite"
                      >
                        <Loading description="Loading…" withOverlay={false} />
                      </div>
                    )}
                  </div>
                )}

                {!hasResults && !loading && (
                  <p>No designates configured for this district yet.</p>
                )}
              </Stack>
            )}
          </Tile>
        </Column>
      </Grid>

      {/* Delete confirmation. Rendered at the page root so its Modal
          z-index doesn't fight with the Tile/Grid above. The same
          rendering branch as the trash-can: if pendingDelete is null
          the Modal stays closed. */}
      <UserSearchModal
        open={userSearchOpen}
        onClose={() => setUserSearchOpen(false)}
        onSelect={handleUserPicked}
      />

      <DestructiveModal
        open={pendingDelete !== null}
        title="Remove designate?"
        message={
          pendingDelete
            ? `This will remove "${pendingDelete.designateIdir}" from the district notification list. They will no longer be CC'd on FSPTS submission emails for this org unit.`
            : ''
        }
        confirmButtonText="Remove"
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
        loading={removingId !== null}
      />
    </>
  );
};

export default DistrictNotificationPage;
