import {
  Button,
  DataTable,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectRow,
} from '@carbon/react';
import {Add, Checkmark, Copy, TrashCan} from '@carbon/icons-react';
import {type FC, useCallback, useEffect, useState} from 'react';

import { StandardsSearchIcon } from '@/components/Layout/navIcons';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import AddExistingStandardModal from '@/components/AddExistingStandardModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import NewStandardModal from '@/components/NewStandardModal';
import {useAuth} from '@/context/auth/useAuth';
import {useNotification} from '@/context/notification/useNotification';
import {canEditFsp} from '@/routes/access';
import {
  copyStandardRegime,
  deleteStandardRegime,
  type FspStandardRow,
  getFspStandards,
} from '@/services/fspSearch';

import StandardRegimeDetailPanel from './StandardRegimeDetailPanel';

interface Props {
  fspId: string;
  /**
   * The FSP's resolved amendment number — needed so the detail proc
   * scopes its FSP-specific org-unit / agreement-holder cursors to
   * the right amendment. Empty is fine; the proc handles it.
   */
  amendmentNumber: string;
  /** Parent-bumped counter that forces a refetch on Submit/Extend/etc. */
  refreshKey?: number;
  /**
   * Current FSP status code. Drives whether the "New Standard" button
   * is reachable — DFT for any submitter, APP/INE for administrators
   * only (matches legacy FSP500's isAddNewEnabled).
   */
  fspStatusCode?: string | null;
  /** Whether the signed-in user has the FSPTS_ADMINISTRATOR role. */
  isAdmin?: boolean;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Column order mirrors the legacy Stocking Standards screen:
// (radio) | SS ID | Standards Name | Objective | Amnd # | BGC | Status | Effective | Default
// `select` is a virtual header to reserve the leading TableSelectRow column.
const HEADERS = [
  { key: 'select', header: '', isSortable: false },
  { key: 'standardsRegimeId', header: 'Standards ID' },
  { key: 'standardsRegimeName', header: 'Standards name' },
  { key: 'standardsObjective', header: 'Objective' },
  { key: 'standardsAmndNumber', header: 'Amendment number' },
  { key: 'standardsBgc', header: 'BGC' },
  { key: 'standardsRegimeStatus', header: 'Status' },
  { key: 'standardsEffectiveDate', header: 'Effective date' },
  { key: 'defaultStandard', header: 'Default standard' },
];

const StockingStandardsTab: FC<Props> = ({
  fspId,
  amendmentNumber,
  refreshKey,
  fspStatusCode,
  isAdmin,
}) => {
  const [rows, setRows] = useState<FspStandardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drives the FSP250 detail panel below the table. null = nothing
  // picked yet; setting it back to null collapses the panel.
  const [selectedRegimeId, setSelectedRegimeId] = useState<string | null>(null);
  const [newStandardOpen, setNewStandardOpen] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { display } = useNotification();

  // Same gating shape the legacy FSP500.isAddNewEnabled used:
  //   - DFT: any submitter can add (the tombstone-side access gate
  //     already restricts who can see the FSP at all).
  //   - Anything except CAN / RET / EXP / DEL: administrators can add.
  //     (Legacy's third branch allowed admins on SUB / OHS / APP / INE
  //     / REJ too — useful for fixing a mid-workflow gap.)
  // Statuses where nobody can add: CAN, RET, EXP, DEL — those are
  // end-of-life states with no editable amendment to attach to.
  const { user } = useAuth();
  // Master role gate — Submitter-only on SUB and View-Only never see
  // mutation affordances. AND-ed with the existing per-status gates
  // below so admins keep their broader capabilities on non-terminal
  // statuses.
  const canEdit = canEditFsp(user, fspStatusCode);
  const status = (fspStatusCode ?? '').toUpperCase();
  const TERMINAL_STATUSES = ['CAN', 'RET', 'EXP', 'DEL'];
  const canCreate =
    canEdit
    && (status === 'DFT'
      || (!!isAdmin && status !== '' && !TERMINAL_STATUSES.includes(status)));
  // Copy is strictly Draft-only — once an FSP has been submitted /
  // approved we don't let the user spawn a side-copy from this UI.
  const canCopy = canEdit && status === 'DFT';

  const refetch = useCallback(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspStandards(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Standards load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId]);

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspStandards(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Standards load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, refreshKey]);

  // Drop any stale selection when the underlying list reloads (e.g.
  // user switched FSP). Without this, the detail panel would chase a
  // regime that may no longer be in the visible set.
  useEffect(() => {
    if (selectedRegimeId && rows && !rows.some((r) => r.standardsRegimeId === selectedRegimeId)) {
      setSelectedRegimeId(null);
    }
  }, [rows, selectedRegimeId]);

  // Selected regime is required for Copy / Delete — pull it off the
  // rows list so we can disable the button (rather than hide it) when
  // nothing's picked. Keeps the action discoverable.
  const selectedRow = selectedRegimeId
    ? (rows ?? []).find((r) => r.standardsRegimeId === selectedRegimeId) ?? null
    : null;

  // Delete strictly follows the legacy FSP550 rule
  // (StandardsButtonManager.getEnableDelete): the REGIME row's own
  // status must be DFT. FSP-level status isn't checked — the proc
  // re-validates anyway. Hide the button entirely while the FSP is
  // in a terminal state so users can't even try.
  const canDelete = canEdit && status !== '' && !TERMINAL_STATUSES.includes(status);
  const selectedIsDraft =
    selectedRow?.standardsRegimeStatus?.trim().toLowerCase() === 'draft';

  const performCopy = async () => {
    if (!selectedRegimeId) return;
    const created = await copyStandardRegime(
      fspId,
      selectedRegimeId,
      amendmentNumber,
    );
    refetch();
    if (created.standardsRegimeId) {
      setSelectedRegimeId(created.standardsRegimeId);
    }
    display({
      kind: 'success',
      title: 'Stocking standard copied.',
      timeout: 5000,
    });
  };

  const performDelete = async () => {
    if (!selectedRegimeId) return;
    await deleteStandardRegime(fspId, selectedRegimeId);
    setSelectedRegimeId(null);
    refetch();
    display({
      kind: 'success',
      title: 'Stocking standard deleted.',
      timeout: 5000,
    });
  };

  // Shared header — same Section title + optional New Standard / Copy
  // Standard / Delete Standard buttons — rendered for loading / empty
  // / loaded states so the user can always get to the create flow even
  // on an empty FSP.
  const headerNode = (
    <header className="fsp-info__tile-header">
      <h2 className="fsp-info__section-title fsp-info__section-title--icon">
        <StandardsSearchIcon width={20} height={20} />
        <span>Stocking standards</span>
      </h2>
      <div className="fsp-info__tile-header-actions">
        {canCopy && (
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Copy}
            onClick={() => setCopyConfirmOpen(true)}
            disabled={!selectedRegimeId}
          >
            Copy standard
          </Button>
        )}
        {canDelete && (
          <Button
            kind="danger--tertiary"
            size="sm"
            renderIcon={TrashCan}
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={!selectedRegimeId || !selectedIsDraft}
          >
            Delete standard
          </Button>
        )}
        {canCreate && (
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Add}
            onClick={() => setAddExistingOpen(true)}
          >
            Add existing standard
          </Button>
        )}
        {canCreate && (
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Add}
            onClick={() => setNewStandardOpen(true)}
          >
            New standard
          </Button>
        )}
      </div>
    </header>
  );

  const newStandardModal = (
    <NewStandardModal
      open={newStandardOpen}
      fspId={fspId}
      amendmentNumber={amendmentNumber}
      onClose={() => setNewStandardOpen(false)}
      onCreated={(created) => {
        refetch();
        if (created.standardsRegimeId) {
          setSelectedRegimeId(created.standardsRegimeId);
        }
      }}
    />
  );

  const addExistingStandardModal = (
    <AddExistingStandardModal
      open={addExistingOpen}
      fspId={fspId}
      amendmentNumber={amendmentNumber}
      onClose={() => setAddExistingOpen(false)}
      onAdded={(newRegimeId) => {
        refetch();
        if (newRegimeId) setSelectedRegimeId(newRegimeId);
      }}
    />
  );

  const copyConfirmModal = (
    <ConfirmationModal
      open={copyConfirmOpen}
      onClose={() => setCopyConfirmOpen(false)}
      heading="Copy stocking standard"
      confirmLabel="Copy"
      errorTitle="Failed to copy standard"
      onConfirm={performCopy}
    >
      <p>
        Duplicate{' '}
        <strong>
          {selectedRow?.standardsRegimeName?.trim()
            || `Regime ${selectedRow?.standardsRegimeId ?? ''}`}
        </strong>{' '}
        on this FSP? The new standards regime will start as a Draft with
        all of the source regime's layers, species, and BGC site series
        copied over.
      </p>
    </ConfirmationModal>
  );

  const deleteConfirmModal = (
    <ConfirmationModal
      open={deleteConfirmOpen}
      onClose={() => setDeleteConfirmOpen(false)}
      heading="Delete stocking standard"
      confirmLabel="Delete"
      danger
      errorTitle="Failed to delete standard"
      onConfirm={performDelete}
    >
      <p>
        Permanently remove{' '}
        <strong>
          {selectedRow?.standardsRegimeName?.trim()
            || `Regime ${selectedRow?.standardsRegimeId ?? ''}`}
        </strong>{' '}
        from this FSP? All of its layers, species, and BGC site series
        will be deleted. This cannot be undone.
      </p>
    </ConfirmationModal>
  );

  if (loading && !rows) {
    return (
      <>
        <section className="fsp-info__tile fsp-info__tile--full">
          {headerNode}
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading standards…" withOverlay={false} />
          </div>
        </section>
        {newStandardModal}
        {addExistingStandardModal}
        {copyConfirmModal}
        {deleteConfirmModal}
      </>
    );
  }
  if (error) {
    return (
      <>
        <section className="fsp-info__tile fsp-info__tile--full">
          {headerNode}
          <p className="fsp-info__error">{error}</p>
        </section>
        {newStandardModal}
        {addExistingStandardModal}
        {copyConfirmModal}
        {deleteConfirmModal}
      </>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <>
        <section className="fsp-info__tile fsp-info__tile--full">
          {headerNode}
          <p className="fsp-info__placeholder">
            No stocking standards on this FSP.
          </p>
        </section>
        {newStandardModal}
        {addExistingStandardModal}
        {copyConfirmModal}
        {deleteConfirmModal}
      </>
    );
  }

  const tableRows = rows.map((r, i) => ({
    id: r.standardsRegimeId ?? `row-${i}`,
    standardsRegimeId: dash(r.standardsRegimeId),
    standardsRegimeName: dash(r.standardsRegimeName),
    standardsObjective: dash(r.standardsObjective),
    standardsAmndNumber: dash(r.standardsAmndNumber),
    standardsBgc: dash(r.standardsBgc),
    standardsRegimeStatus: dash(r.standardsRegimeStatus),
    standardsEffectiveDate: dash(r.standardsEffectiveDate),
    // Carbon DataTable can't render JSX from this map, so store the raw
    // Y/N here and switch in the cell renderer below.
    defaultStandard: r.defaultStandardInd === 'Y' ? 'Y' : '',
    __regimeId: r.standardsRegimeId,
  }));

  return (
    <>
      <section className="fsp-info__tile fsp-info__tile--full">
        {headerNode}
        <div className="bordered-table">
          <DataTable rows={tableRows} headers={HEADERS} isSortable>
            {({ rows: r, headers, getTableProps, getHeaderProps }) => (
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
                    {r.map((row) => {
                      // Look up the raw regime id from the source row by
                      // matching row.id (which is the regime id itself
                      // unless the source row was missing it).
                      const source = tableRows.find((s) => s.id === row.id);
                      const regimeId = source?.__regimeId ?? null;
                      const isSelected =
                        regimeId !== null && regimeId === selectedRegimeId;
                      const pick = () => {
                        if (regimeId) setSelectedRegimeId(regimeId);
                      };
                      return (
                        <TableRow
                          key={row.id}
                          className={`fsp-info__row app-table__row--selectable${
                            isSelected ? ' fsp-info__row--selected' : ''
                          }`}
                          onClick={pick}
                        >
                          {row.cells.map((cell) => {
                            if (cell.info.header === 'select') {
                              return (
                                <TableSelectRow
                                  key={cell.id}
                                  radio
                                  id={`ss-select-${row.id}`}
                                  name="ss-selection"
                                  ariaLabel={`Select standards regime ${row.id}`}
                                  checked={isSelected}
                                  onSelect={pick}
                                />
                              );
                            }
                            if (
                              cell.info.header === 'standardsRegimeStatus' &&
                              cell.value
                            ) {
                              const status = cell.value as string;
                              return (
                                <TableCell key={cell.id}>
                                  <StatusTag status={status} />
                                </TableCell>
                              );
                            }
                            if (cell.info.header === 'defaultStandard') {
                              return (
                                <TableCell key={cell.id}>
                                  {cell.value === 'Y' ? (
                                    <Checkmark
                                      size={16}
                                      aria-label="Default standard"
                                    />
                                  ) : null}
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={cell.id}>{cell.value as string}</TableCell>
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
      </section>

      {selectedRegimeId && (
        <StandardRegimeDetailPanel
          fspId={fspId}
          amendmentNumber={amendmentNumber}
          regimeId={selectedRegimeId}
          // readOnly cuts every inline mutation in the panel (Overview
          // Edit, Layers add/edit/delete, BGC add/edit/delete) when
          // the user can't edit the FSP. !canEdit covers Submitter-on-
          // SUB and View-Only across all statuses.
          readOnly={!canEdit}
        />
      )}
      {newStandardModal}
      {addExistingStandardModal}
      {copyConfirmModal}
      {deleteConfirmModal}
    </>
  );
};

export default StockingStandardsTab;
