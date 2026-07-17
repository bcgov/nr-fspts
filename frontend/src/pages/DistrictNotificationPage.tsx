import {
  Button,
  DataTable,
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
import { Add, Location, TrashCan } from '@carbon/icons-react';
import { useCallback, useEffect, useRef, useState, type FC } from 'react';

import { DestructiveModal } from '@/components/core/DestructiveModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { UserSearchModal } from '@/components/UserSearchModal';
import { useNotification } from '@/context/notification/useNotification';
import { safeErrorMessage } from '@/lib/errorMessage';
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

// Designate IDIRs are stored with the AD prefix ("IDIR\MAVILLEN"); the
// user-lookup API expects the bare name. Strip whatever sits ahead of the last backslash.
const stripIdirPrefix = (idir: string): string => {
  const idx = idir.lastIndexOf('\\');
  return idx >= 0 ? idir.slice(idx + 1) : idir;
};

// Display label for a designate: prefer the resolved name, fall back to the
// raw IDIR username (e.g. before the nr-user-lookup enrichment resolves).
const designateLabel = (d: NotificationDesignate): string =>
  d.displayName?.trim() || d.designateIdir;

import './DistrictNotificationPage.scss';

const HEADERS = [
  { key: 'designateIdir', header: 'IDIR username' },
  { key: 'displayName', header: 'Name' },
  { key: 'emailAddress', header: 'Email address' },
  { key: 'actions', header: 'Actions', isSortable: false },
];

const formatCellText = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const DistrictNotificationPage: FC = () => {
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [codeListsLoading, setCodeListsLoading] = useState(true);

  // Form state — only the district matters; designate IDIR comes
  // entirely from the user-search modal pick.
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
  // IDIR lookup popup state. The "Find user" button opens it; on
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
          setError(safeErrorMessage(e, 'Failed to load org units.'));
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
      // Kick off nr-user-lookup-api profile lookups in the background. The list is
      // already visible at this point; displayName/email cells render
      // as "—" until the lookups resolve.
      if (rows.length > 0) {
        void enrichDesignates(orgUnit, rows);
      }
    } catch (e) {
      setError(safeErrorMessage(e, 'Failed to load designates.'));
      setDesignates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetches each row's nr-user-lookup-api profile in parallel, then merges the
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

  // User-picker callback. Selecting a row in the user-search modal
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
        const name =
          user.displayName?.trim() ||
          `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
          user.userId;
        const districtName =
          orgUnits.find((o) => o.code === orgUnitNo)?.description ?? orgUnitNo;
        display({
          kind: 'success',
          title: 'Designate added',
          subtitle: `${name} will now receive FSP submission notifications for ${districtName}`,
          timeout: 6000,
        });
      } catch (e) {
        setError(safeErrorMessage(e, 'Failed to add designate.'));
      } finally {
        setAdding(false);
      }
    },
    [orgUnitNo, loadDesignates, orgUnits, display],
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
    // Capture name + district now — pendingDelete is cleared on success.
    const name = designateLabel(pendingDelete);
    const districtName =
      orgUnits.find((o) => o.code === orgUnitNo)?.description ?? orgUnitNo;
    setRemovingId(targetId);
    setError(null);
    try {
      await removeDistrictDesignate(targetId);
      setPendingDelete(null);
      await loadDesignates(orgUnitNo);
      display({
        kind: 'success',
        title: 'Designate deleted',
        subtitle: `${name} will no longer receive FSP submission notifications for ${districtName}`,
        timeout: 6000,
      });
    } catch (e) {
      setError(safeErrorMessage(e, 'Failed to remove designate.'));
    } finally {
      setRemovingId(null);
    }
  }, [pendingDelete, orgUnitNo, loadDesignates, orgUnits, display]);

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

  // Bare, UPPER-CASED IDIR usernames already designated for this district —
  // handed to the search modal so it can disable "Add" for existing designates.
  const existingUserIds = new Set(
    (designates ?? [])
      .map((d) => stripIdirPrefix(d.designateIdir ?? '').trim().toUpperCase())
      .filter(Boolean),
  );

  return (
    <div className="fsp-district-page">
      <div className="fsp-district__header">
        <div>
          <h1>District notification</h1>
          <p className="fsp-district__subtitle">
            Manage who receives email notifications for FSP submissions in
            each district.
          </p>
        </div>
      </div>

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

      </Tile>

      {designates !== null && !error && (
        <div className="fsp-district__results-fullbleed">
          <div className="fsp-district__results">
            {/* Gray banner: designate count on the left, the "Add designate"
                trigger on the right. Shown whenever a district is selected —
                even with zero designates — so the first one can be added.
                Clicking opens the search modal; picking a user there is the
                entire add gesture (handleUserPicked fires SAVE directly). */}
            <div className="fsp-district__results-header">
              <span className="fsp-district__results-count">
                {(designates?.length ?? 0).toLocaleString()}{' '}
                {designates?.length === 1 ? 'designate' : 'designates'}
              </span>
              <Button
                className="fsp-district__add-trigger"
                kind="primary"
                size="md"
                renderIcon={Add}
                onClick={() => setUserSearchOpen(true)}
                disabled={adding || loading}
              >
                {adding ? 'Saving…' : 'Add designate'}
              </Button>
            </div>

            {hasResults ? (
              <Stack gap={0}>
                <div className="fsp-district__table-container">
                  <div className={loading ? 'fsp-district__table--loading' : undefined}>
                    <div className="fsp-district__table">
                      <DataTable rows={tableRows} headers={HEADERS} isSortable>
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
                                                    onClick={() => requestDelete(designate)}
                                                    disabled={isRemoving || loading}
                                                  >
                                                    {isRemoving ? 'Removing…' : 'Delete'}
                                                  </Button>
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
              </Stack>
            ) : (
              !loading && (
                <EmptyState
                  title="No designates yet"
                  body={
                    <>
                      No designates are configured for this district.
                      <br />
                      Use “Add designate” above to add notification recipients.
                    </>
                  }
                />
              )
            )}
          </div>
        </div>
      )}

      {/* No district picked yet — a gray full-bleed pane inviting the user
          to choose one (same container as the results/empty-designates
          panes so the background + centering match). Mutually exclusive
          with the results block: no district ⇒ designates is null. */}
      {!orgUnitNo && !error && (
        <div className="fsp-district__results-fullbleed">
          <div className="fsp-district__results">
            <EmptyState
              icon={<Location size={48} />}
              title="No district selected"
              body="Select a district above to view and manage its designates."
            />
          </div>
        </div>
      )}

      {/* Delete confirmation. Rendered at the page root so its Modal
          z-index doesn't fight with the page chrome above. The same
          rendering branch as the trash-can: if pendingDelete is null
          the Modal stays closed. */}
      <UserSearchModal
        open={userSearchOpen}
        onClose={() => setUserSearchOpen(false)}
        onSelect={handleUserPicked}
        districtLabel={
          orgUnits.find((o) => o.code === orgUnitNo)?.description ?? ''
        }
        existingUserIds={existingUserIds}
      />

      <DestructiveModal
        open={pendingDelete !== null}
        title="Are you sure you want to delete this designate?"
        message={
          pendingDelete ? (
            <>
              This deletes <strong>{designateLabel(pendingDelete)}</strong> from
              the{' '}
              {orgUnits.find((o) => o.code === orgUnitNo)?.description ??
                orgUnitNo}{' '}
              notification list.
              <br />
              <br />
              They will no longer receive FSP submission notifications for this
              district.
            </>
          ) : (
            ''
          )
        }
        confirmButtonText="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
        loading={removingId !== null}
      />
    </div>
  );
};

export default DistrictNotificationPage;
