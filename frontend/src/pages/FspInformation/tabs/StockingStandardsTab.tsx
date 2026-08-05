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
  TableSelectRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
} from '@carbon/react';
import {Add, CheckmarkFilled, Download, SubtractAlt} from '@carbon/icons-react';
import { AddDocument } from '@carbon/pictograms-react';
import { NoResultsFoundIcon } from '@/components/EmptyState/NoResultsFoundIcon';
import {type FC, type SVGProps, useCallback, useEffect, useRef, useState} from 'react';

import { StandardsSearchIcon } from '@/components/Layout/navIcons';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import AddExistingStandardModal from '@/components/AddExistingStandardModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import NewStandardModal from '@/components/NewStandardModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import {useAuth} from '@/context/auth/useAuth';
import {useNotification} from '@/context/notification/useNotification';
import {safeErrorMessage} from '@/lib/errorMessage';
import {canEditFsp} from '@/routes/access';
import {
  copyStandardRegime,
  deleteStandardRegime,
  type FspStandardRow,
  getFspStandards,
  getStandardRegimeDetail,
  getStandardRegimeLayerDetail,
  type StandardRegimeBgcZone,
  type StandardRegimeDetail,
  type StandardRegimeLayerDetail,
  type StandardRegimeSpecies,
  unlinkDefaultStandard,
} from '@/services/fspSearch';

import { useEditLock } from '../editLock';
import StandardRegimeDetailPanel from './StandardRegimeDetailPanel';

// Adapter so the custom Stocking-standards nav icon renders at Carbon's
// button-icon size. Carbon passes renderIcon `{ size: 16, className,
// aria-hidden }`; the nav icon ignores `size`, so map it onto
// width/height and forward the rest (className carries Carbon's
// `cds--btn__icon` spacing). Same icon the parent "Stocking standards"
// tab uses.
const CreateStandardIcon = ({
  size = 16,
  ...props
}: { size?: number } & SVGProps<SVGSVGElement>) => (
  <StandardsSearchIcon width={size} height={size} {...props} />
);

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
  { key: 'standardsAmndNumber', header: 'Version' },
  { key: 'standardsBgc', header: 'BGC' },
  { key: 'standardsRegimeStatus', header: 'Status' },
  { key: 'standardsEffectiveDate', header: 'Effective date' },
  { key: 'defaultStandard', header: 'Default standard' },
];

// ── Comprehensive CSV export ────────────────────────────────────────
// The table shows summary columns only; the download pulls each standard's
// FULL detail (overview + layers/species + districts + agreement holders +
// BGC zones + attachments) and flattens it into one wide row. Multi-element
// fields become multi-line cells — RFC-4180 quoting keeps embedded newlines
// valid so a spreadsheet renders them as line breaks in one cell.

type StandardExport = {
  row: FspStandardRow;
  detail: StandardRegimeDetail;
  layers: StandardRegimeLayerDetail[];
};

const CSV_COLUMNS = [
  'Standards ID',
  'Standards name',
  'Objective',
  'Version',
  'Status',
  'Default standard',
  'Effective date',
  'Expiry date',
  'Regulation',
  'Geographic description',
  'Regen obligation',
  'Regen delay (yrs)',
  'Free growing early (yrs)',
  'Free growing late (yrs)',
  'No-regen early (yrs)',
  'No-regen late (yrs)',
  'Additional standards',
  'Submitted by',
  'Associated FSPs',
  'Districts',
  'Agreement holders',
  'BGC zones',
  'Attachments',
  'Layers',
];

const csvEscape = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const nz = (v: string | null | undefined): string =>
  v && v.trim() !== '' ? v.trim() : '';

const versionLabel = (amd: string | null | undefined): string =>
  String(amd ?? '').trim() === '0' ? 'Original' : nz(amd);

const yesNoInd = (ind: string | null | undefined): string =>
  ind === 'Y' ? 'Yes' : ind === 'N' ? 'No' : '';

const formatBgcZone = (z: StandardRegimeBgcZone): string => {
  const zone =
    `${nz(z.bgcZoneCode)}${nz(z.bgcSubzoneCode)}${nz(z.bgcVariant)}` +
    (z.bgcPhase ? ` ${z.bgcPhase}` : '');
  const site = [nz(z.becSiteSeriesCd), nz(z.becSiteSeriesPhaseCd)]
    .filter(Boolean)
    .join('');
  const parts = [zone.trim(), site && `site series ${site}`].filter(Boolean);
  return parts.join(' / ') + (z.becSeral ? ` (seral ${z.becSeral})` : '');
};

const formatSpecies = (list: StandardRegimeSpecies[]): string =>
  list
    .map((s) => {
      const name = [nz(s.code), nz(s.description)].filter(Boolean).join(' — ');
      return s.minHeight ? `${name} (min ht ${s.minHeight} m)` : name;
    })
    .join('; ');

const formatLayer = (l: StandardRegimeLayerDetail): string => {
  const scalars: [string, string | null][] = [
    ['Target stocking', l.targetStocking],
    ['Min stocking', l.minStockingStandard],
    ['Min preferred stocking', l.minPrefStockingStandard],
    ['Min horizontal distance', l.minHorizontalDistance],
    ['Residual basal area', l.residualBasalArea],
    ['Min post-spacing', l.minPostSpacing],
    ['Max post-spacing', l.maxPostSpacing],
    ['Max coniferous', l.maxConifer],
    ['Height relative to comp', l.heightRelativeToComp],
    ['Tree size unit', l.treeSizeUnitCode],
  ];
  const scalarLine = scalars
    .filter(([, v]) => nz(v) !== '')
    .map(([label, v]) => `${label}: ${v}`)
    .join(', ');
  const pref = l.preferredSpecies?.length
    ? `Preferred: ${formatSpecies(l.preferredSpecies)}`
    : '';
  const acc = l.acceptableSpecies?.length
    ? `Acceptable: ${formatSpecies(l.acceptableSpecies)}`
    : '';
  return [`Layer ${nz(l.layerCode) || '—'}`, scalarLine, pref, acc]
    .filter(Boolean)
    .join('\n');
};

const buildStandardsCsv = (items: StandardExport[]): string => {
  const lines = [CSV_COLUMNS.map(csvEscape).join(',')];
  for (const { row, detail, layers } of items) {
    const cells = [
      nz(detail.standardsRegimeId) || nz(row.standardsRegimeId),
      nz(detail.standardsRegimeName),
      nz(detail.standardsObjective),
      versionLabel(detail.standardsAmendNumber ?? row.standardsAmndNumber),
      nz(detail.statusDescription) || nz(row.standardsRegimeStatus),
      detail.mofDefaultStandardInd === 'Y' ? 'Yes' : 'No',
      nz(detail.effectiveDate),
      nz(detail.expiryDate),
      [nz(detail.regulationCode), nz(detail.regulationDescription)]
        .filter(Boolean)
        .join(' — '),
      nz(detail.geographicDescription),
      yesNoInd(detail.regenObligationInd),
      nz(detail.regenDelayOffsetYrs),
      nz(detail.freeGrowingEarlyOffsetYrs),
      nz(detail.freeGrowingLateOffsetYrs),
      nz(detail.noRegenEarlyOffsetYrs),
      nz(detail.noRegenLateOffsetYrs),
      nz(detail.additionalStandards),
      nz(detail.submittedByUserid),
      nz(detail.fspIdList),
      (detail.districts ?? [])
        .map((d) => [nz(d.orgUnitCode), nz(d.orgUnitName)].filter(Boolean).join(' — '))
        .join('\n'),
      (detail.agreementHolders ?? [])
        .map((h) => [nz(h.clientNumber), nz(h.clientName)].filter(Boolean).join(' — '))
        .join('\n'),
      (detail.bgcZones ?? []).map(formatBgcZone).join('\n'),
      (detail.attachments ?? [])
        .map((a) => nz(a.attachmentName))
        .filter(Boolean)
        .join('\n'),
      layers.map(formatLayer).join('\n\n'),
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return lines.join('\n');
};

const StockingStandardsTab: FC<Props> = ({
  fspId,
  amendmentNumber,
  refreshKey,
  fspStatusCode,
  isAdmin,
}) => {
  const [rows, setRows] = useState<FspStandardRow[] | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drives the FSP250 detail panel below the table. null = nothing
  // picked yet; setting it back to null collapses the panel.
  const [selectedRegimeId, setSelectedRegimeId] = useState<string | null>(null);
  // A just-created regime to auto-select once the refreshed list contains it.
  // Set by onCreated and applied by the effect below — setting the selection
  // directly on create would be wiped by the stale-selection effect, because
  // refetch() hasn't landed the new row yet.
  const pendingSelectRef = useRef<string | null>(null);
  // Wraps the detail panel below the table so a fresh row selection can
  // scroll it into view (top-aligned) — the panel is well below the fold
  // on longer standards lists.
  const detailRef = useRef<HTMLDivElement>(null);
  // While any pane (e.g. the selected regime's Overview / Layers) is being
  // edited, lock the regime-level actions so the user can't create / add /
  // copy / delete a standard mid-edit.
  const { anyEditing } = useEditLock();
  const [newStandardOpen, setNewStandardOpen] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  // Client-side search + pagination over the full standards list (loaded
  // once). Search matches ID / name / objective / BGC.
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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
  // Copy + Delete share the same gate: an editable, non-terminal FSP.
  // Both act only on a DRAFT standard (enforced via selectedIsDraft where
  // they're passed to the panel), so they surface together in the header.
  const canCopy = canEdit && status !== '' && !TERMINAL_STATUSES.includes(status);

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
          setError(safeErrorMessage(e, 'Standards load failed.'));
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
          setError(safeErrorMessage(e, 'Standards load failed.'));
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

  // Auto-select a freshly created standard once the reloaded list includes it,
  // then bring its detail panel into view (mirrors a row click).
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (pending && rows?.some((r) => r.standardsRegimeId === pending)) {
      setSelectedRegimeId(pending);
      pendingSelectRef.current = null;
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [rows]);

  // Selected regime is required for Copy / Delete — pull it off the
  // rows list so we can disable the button (rather than hide it) when
  // nothing's picked. Keeps the action discoverable.
  const selectedRow = selectedRegimeId
    ? (rows ?? []).find((r) => r.standardsRegimeId === selectedRegimeId) ?? null
    : null;

  // Delete follows the legacy FSP550 rule
  // (StandardsButtonManager.getEnableDelete). `canEdit` (= canEditFsp) is the
  // FSP-level gate: Administrator in any status, and — the case to be explicit
  // about — the owning **Submitter while the FSP/amendment being viewed is a
  // DRAFT (DFT)**. So on a Draft version a Submitter DOES get Delete (and
  // Unlink below). The button is hidden entirely on terminal statuses, and
  // only lights up for a draft standard (selectedIsDraft, at the call site).
  // The proc re-validates the selected regime's own status server-side.
  // See docs/permission-matrix.md § B1a.
  const canDelete = canEdit && status !== '' && !TERMINAL_STATUSES.includes(status);
  const selectedIsDraft =
    selectedRow?.standardsRegimeStatus?.trim().toLowerCase() === 'draft';
  // Unlink is the default-standard counterpart of Delete: legacy
  // "Unlink Default Standard" (StandardsButtonManager.get250UnlinkEnabled)
  // applies only to MoF default standards. Same FSP-level edit gate as Delete
  // (canEdit → Admin any status, Submitter on DFT only), so a Submitter gets
  // Unlink on a Draft FSP/amendment too. A standard is either a draft (Delete)
  // or a default (Unlink), never both.
  const selectedIsDefault = selectedRow?.defaultStandardInd === 'Y';

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
    // Capture the name before the selection is cleared below.
    const name =
      selectedRow?.standardsRegimeName?.trim() ||
      `Standard ${selectedRow?.standardsRegimeId ?? selectedRegimeId}`;
    await deleteStandardRegime(fspId, selectedRegimeId);
    setSelectedRegimeId(null);
    refetch();
    display({
      kind: 'success',
      title: `${name} deleted`,
      subtitle: `${name} was deleted from this FSP`,
      timeout: 5000,
    });
  };

  const performUnlink = async () => {
    if (!selectedRegimeId) return;
    // Capture the name before the selection is cleared below.
    const name =
      selectedRow?.standardsRegimeName?.trim() ||
      `Standard ${selectedRow?.standardsRegimeId ?? selectedRegimeId}`;
    await unlinkDefaultStandard(fspId, selectedRegimeId, amendmentNumber);
    setSelectedRegimeId(null);
    refetch();
    display({
      kind: 'success',
      title: `${name} unlinked`,
      subtitle: `${name} was unlinked from this FSP`,
      timeout: 5000,
    });
  };

  // Shared header — same Section title + optional New Standard / Copy
  // Standard / Delete Standard buttons — rendered for loading / empty
  // / loaded states so the user can always get to the create flow even
  // on an empty FSP.
  const renderHeader = (count?: number) => (
    <header className="fsp-info__tile-header">
      <div className="fsp-info__tile-heading">
        <h2 className="fsp-info__standards-heading">
          {count != null
            ? `${count} stocking standard${count === 1 ? '' : 's'}`
            : 'Stocking standards'}
        </h2>
        <p className="fsp-info__tile-instruction">
          Select one to view details below.
        </p>
      </div>
      <div className="fsp-info__tile-header-actions">
        {canCreate && (
          <Button
            kind="ghost"
            size="sm"
            className="fsp-info__link-icon-btn"
            renderIcon={CreateStandardIcon}
            disabled={anyEditing}
            onClick={() => setNewStandardOpen(true)}
          >
            Create stocking standard
          </Button>
        )}
        {canCreate && (
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Add}
            disabled={anyEditing}
            onClick={() => setAddExistingOpen(true)}
          >
            Add existing standard
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
          // Defer selection until the refreshed list includes the new row
          // (see the effect above) so it isn't cleared as a stale selection.
          pendingSelectRef.current = created.standardsRegimeId;
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
        // Defer selection until the refreshed list includes the new/linked row
        // (see the pending-select effect) so it isn't cleared as a stale
        // selection while refetch() is still in flight.
        if (newRegimeId) pendingSelectRef.current = newRegimeId;
      }}
    />
  );

  const copyConfirmModal = (
    <ConfirmationModal
      open={copyConfirmOpen}
      onClose={() => setCopyConfirmOpen(false)}
      heading={`Copy ${selectedRow?.standardsRegimeId ?? ''} onto this FSP?`}
      confirmLabel="Copy"
      errorTitle="Failed to copy standard"
      onConfirm={performCopy}
    >
      <p>
        The copy will be assigned a new Standards ID and start as a Draft,
        with the source regime's layers, species, and BGC site series
        copied over.
      </p>
    </ConfirmationModal>
  );

  const deleteConfirmModal = (
    <ConfirmationModal
      open={deleteConfirmOpen}
      onClose={() => setDeleteConfirmOpen(false)}
      heading="Are you sure you want to delete this stocking standard?"
      confirmLabel="Delete"
      danger
      errorTitle="Failed to delete standard"
      onConfirm={performDelete}
    >
      <p>
        <strong>
          &ldquo;{selectedRow?.standardsRegimeName?.trim()
            || `Standard ${selectedRow?.standardsRegimeId ?? ''}`}&rdquo;
        </strong>{' '}
        and all of its data will be deleted. This cannot be undone.
      </p>
    </ConfirmationModal>
  );

  const unlinkConfirmModal = (
    <ConfirmationModal
      open={unlinkConfirmOpen}
      onClose={() => setUnlinkConfirmOpen(false)}
      heading={`Unlink ${
        selectedRow?.standardsRegimeName?.trim() ||
        `Standard ${selectedRow?.standardsRegimeId ?? ''}`.trim() ||
        'stocking standard'
      } from this FSP?`}
      confirmLabel="Unlink"
      errorTitle="Failed to unlink standard"
      onConfirm={performUnlink}
    >
      <p>
        Only the link is removed. The default standard itself is not deleted and
        can be added again later.
      </p>
    </ConfirmationModal>
  );

  if (loading && !rows) {
    return (
      <>
        <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
          {renderHeader()}
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading standards…" withOverlay={false} />
          </div>
        </section>
        {newStandardModal}
        {addExistingStandardModal}
        {copyConfirmModal}
        {deleteConfirmModal}
        {unlinkConfirmModal}
      </>
    );
  }
  if (error) {
    return (
      <>
        <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
          {renderHeader()}
          <p className="fsp-info__error">{error}</p>
        </section>
        {newStandardModal}
        {addExistingStandardModal}
        {copyConfirmModal}
        {deleteConfirmModal}
        {unlinkConfirmModal}
      </>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <>
        <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
          <div className="fsp-info__empty-state">
            <AddDocument
              width={48}
              height={48}
              className="fsp-info__empty-state-icon"
            />
            <h3 className="fsp-info__empty-state-title">
              No stocking standards for this FSP
            </h3>
            <p className="fsp-info__empty-state-body">
              {canCreate
                ? 'Specify the standards that will be used to judge whether '
                  + 'reforestation is successful.'
                : 'None have been added for this version. Standards can be '
                  + 'added while the FSP amendment is in Draft.'}
            </p>
            {canCreate && (
              <div className="fsp-info__empty-state-actions">
                <Button
                  kind="ghost"
                  className="fsp-info__link-icon-btn"
                  renderIcon={CreateStandardIcon}
                  onClick={() => setNewStandardOpen(true)}
                >
                  Create stocking standard
                </Button>
                <Button
                  kind="tertiary"
                  renderIcon={Add}
                  onClick={() => setAddExistingOpen(true)}
                >
                  Add existing standard
                </Button>
              </div>
            )}
          </div>
        </section>
        {newStandardModal}
        {addExistingStandardModal}
        {copyConfirmModal}
        {deleteConfirmModal}
        {unlinkConfirmModal}
      </>
    );
  }

  // Client-side search over the raw fields (ID / name / objective / BGC).
  const term = searchTerm.trim().toLowerCase();
  const filteredSource = term
    ? rows.filter((r) =>
        [
          r.standardsRegimeId,
          r.standardsRegimeName,
          r.standardsObjective,
          r.standardsBgc,
        ].some((f) => (f ?? '').toString().toLowerCase().includes(term)),
      )
    : rows;

  const tableRows = filteredSource.map((r, i) => ({
    id: r.standardsRegimeId ?? `row-${i}`,
    standardsRegimeId: dash(r.standardsRegimeId),
    standardsRegimeName: dash(r.standardsRegimeName),
    standardsObjective: dash(r.standardsObjective),
    // Version 0 is the original plan — show "Original" instead of "0".
    standardsAmndNumber:
      String(r.standardsAmndNumber ?? '').trim() === '0'
        ? 'Original'
        : dash(r.standardsAmndNumber),
    standardsBgc: dash(r.standardsBgc),
    standardsRegimeStatus: dash(r.standardsRegimeStatus),
    standardsEffectiveDate: dash(r.standardsEffectiveDate),
    // Carbon DataTable can't render JSX from this map, so store the raw
    // Y/N here and switch in the cell renderer below.
    defaultStandard: r.defaultStandardInd === 'Y' ? 'Y' : '',
    __regimeId: r.standardsRegimeId,
  }));

  // Pagination math (client-side). Clamp the page so a shrinking filtered
  // set never leaves us on an out-of-range page.
  const totalItems = tableRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;

  // Export the ENTIRE table (all rows, ignoring the current search filter),
  // with each standard's FULL detail. Pulls the overview + per-layer species
  // for every standard, so it's async + shows a busy state while it runs.
  const downloadCsv = async () => {
    if (csvBusy || !rows || rows.length === 0) return;
    setCsvBusy(true);
    // Layers that couldn't make it into the export. Tracked so a partial CSV
    // is reported rather than handed over as if it were complete — the
    // per-layer catch below swallows failures to keep one bad layer from
    // killing the whole download.
    let omittedLayers = 0;
    try {
      const items = await Promise.all(
        rows.map(async (rr): Promise<StandardExport> => {
          const regimeId = rr.standardsRegimeId ?? '';
          const amd = String(rr.standardsAmndNumber ?? amendmentNumber ?? '');
          const detail = await getStandardRegimeDetail(fspId, regimeId, amd);
          // A layer the regime reported without an id (or code) can't be
          // fetched: the detail GET needs a real (regimeId, layerId) pair and
          // FSP_550_SUB_LAYERS answers a blank one with record.invalid. Skip
          // those rather than firing a request that can only fail.
          const declared = detail.layers ?? [];
          const fetchable = declared.filter((l) => l.layerCode && l.layerId);
          omittedLayers += declared.length - fetchable.length;
          const layers = await Promise.all(
            fetchable.map((l) =>
              getStandardRegimeLayerDetail(
                fspId,
                regimeId,
                l.layerCode as string,
                l.layerId as string,
              ).catch(() => null),
            ),
          );
          const loaded = layers.filter(
            (l): l is StandardRegimeLayerDetail => l != null,
          );
          omittedLayers += layers.length - loaded.length;
          return { row: rr, detail, layers: loaded };
        }),
      );
      const blob = new Blob([buildStandardsCsv(items)], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fsp-${fspId}-stocking-standards.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // The file downloaded, but say so if it's short — otherwise a partial
      // export reads as a complete one.
      if (omittedLayers > 0) {
        display({
          kind: 'warning',
          title: 'CSV downloaded, but some layer detail is missing',
          subtitle: `${omittedLayers} layer${omittedLayers === 1 ? '' : 's'} could not be loaded and ${omittedLayers === 1 ? 'was' : 'were'} left out of the file.`,
          timeout: 9000,
        });
      }
    } catch (e) {
      display({
        kind: 'error',
        title: 'Could not build the CSV',
        subtitle: safeErrorMessage(
          e,
          'The full standards detail could not be loaded. Please try again.',
        ),
        timeout: 7000,
      });
    } finally {
      setCsvBusy(false);
    }
  };

  return (
    <>
      <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
        {renderHeader(rows.length)}
        <div className="bordered-table fsp-info__standards-table">
          <DataTable rows={tableRows} headers={HEADERS} isSortable>
            {({ rows: r, headers, getTableProps, getHeaderProps }) => (
              <TableContainer>
                <TableToolbar>
                  <TableToolbarContent className="fsp-info__standards-toolbar">
                    <TableToolbarSearch
                      persistent
                      placeholder="Search by ID, name, objective or BGC"
                      onChange={(e) => {
                        setSearchTerm(e === '' ? '' : e.target.value);
                        setPage(1);
                      }}
                    />
                    <Button
                      kind="ghost"
                      size="sm"
                      className="fsp-info__link-icon-btn"
                      renderIcon={Download}
                      disabled={csvBusy}
                      onClick={() => void downloadCsv()}
                    >
                      {csvBusy ? 'Preparing…' : 'Download (.csv)'}
                    </Button>
                  </TableToolbarContent>
                </TableToolbar>
                {r.length === 0 ? (
                  <EmptyState
                    icon={<NoResultsFoundIcon />}
                    title="No results found"
                    body={
                      <>
                        No stocking standards match your search criteria.
                        <br />
                        Try adjusting your filters and searching again.
                      </>
                    }
                  />
                ) : (
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
                    {r.slice(pageStart, pageStart + pageSize).map((row) => {
                      // Look up the raw regime id from the source row by
                      // matching row.id (which is the regime id itself
                      // unless the source row was missing it).
                      const source = tableRows.find((s) => s.id === row.id);
                      const regimeId = source?.__regimeId ?? null;
                      const isSelected =
                        regimeId !== null && regimeId === selectedRegimeId;
                      const pick = () => {
                        if (!regimeId) return;
                        // Locked while a pane is being edited — switching the
                        // selected standard would unmount the open editor and
                        // discard the in-progress changes.
                        if (anyEditing) return;
                        setSelectedRegimeId(regimeId);
                        // Wait for the panel to (re)render, then bring its
                        // top up to the top of the viewport so the user
                        // lands on the Overview panel.
                        requestAnimationFrame(() => {
                          detailRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                        });
                      };
                      return (
                        <TableRow
                          key={row.id}
                          className={
                            anyEditing
                              ? 'fsp-info__row'
                              : 'fsp-info__row app-table__row--selectable'
                          }
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
                                  disabled={anyEditing && !isSelected}
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
                                    <span className="fsp-search__bool fsp-search__bool--yes">
                                      <CheckmarkFilled size={16} />
                                      Yes
                                    </span>
                                  ) : (
                                    <span className="fsp-search__bool fsp-search__bool--no">
                                      <SubtractAlt size={16} />
                                      No
                                    </span>
                                  )}
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
                )}
              </TableContainer>
            )}
          </DataTable>
          {tableRows.length > 0 && (
          <Pagination
            className="fsp-info__standards-pagination"
            page={safePage}
            pageSize={pageSize}
            pageSizes={[10, 25, 50]}
            totalItems={totalItems}
            size="md"
            onChange={({ page: p, pageSize: ps }) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
          )}
        </div>
      </section>

      <div ref={detailRef}>
      {selectedRegimeId ? (
        <StandardRegimeDetailPanel
          // Remount on regime change. Without this the panel re-renders with
          // the NEW regimeId while `detail` still holds the OLD regime's data
          // (setDetail(null) runs in an effect, i.e. after paint), so the
          // Layers child fires FSP_550_SUB_LAYERS.GET with the new regime id
          // and the previous regime's layerCode/layerId — an unmatchable pair
          // that returns record.invalid and toasts "Unable to load layer
          // detail" before the correct fetch lands a moment later.
          key={selectedRegimeId}
          fspId={fspId}
          amendmentNumber={amendmentNumber}
          regimeId={selectedRegimeId}
          // readOnly cuts every inline mutation in the panel (Overview
          // Edit, Layers add/edit/delete, BGC add/edit/delete) when
          // the user can't edit the FSP. !canEdit covers Submitter-on-
          // SUB and View-Only across all statuses.
          readOnly={!canEdit}
          // Copy / Delete / Unlink live in the panel header (all act on the
          // selected regime); the confirm dialogs + persist stay here.
          // Mutually exclusive by regime type: draft standards can be Copied
          // (into a new draft) and Deleted; default (approved) standards can
          // only be Unlinked — never Copied or Deleted.
          canCopy={canCopy && selectedIsDraft}
          onCopy={() => setCopyConfirmOpen(true)}
          canDelete={canDelete && selectedIsDraft}
          onDelete={() => setDeleteConfirmOpen(true)}
          canUnlink={canDelete && selectedIsDefault}
          onUnlink={() => setUnlinkConfirmOpen(true)}
        />
      ) : (
        <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
          <div className="fsp-info__detail-empty">
            Select a standard above to see its details here.
          </div>
        </section>
      )}
      </div>
      {newStandardModal}
      {addExistingStandardModal}
      {copyConfirmModal}
      {deleteConfirmModal}
      {unlinkConfirmModal}
    </>
  );
};

export default StockingStandardsTab;
