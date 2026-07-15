import {
  Button,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import {Edit, Launch, Map} from '@carbon/icons-react';
import {type FC, useEffect, useMemo, useState} from 'react';

import EmptyState from '@/components/EmptyState/EmptyState';
import FduLicencesModal from '@/components/FduLicencesModal';
import {useNotification} from '@/context/notification/useNotification';
import {env} from '@/env';
import {type FspFduList, getFspExtent, getFspFduList,} from '@/services/fspSearch';

interface Props {
  fspId: string;
  amendmentNumber: string;
  /** Title shown above the extent card. */
  variant: 'fdu';
  /**
   * Current FSP status code (DFT/APP/SUB/...). Drives whether per-row
   * "Edit licences" is shown — DFT for any submitter, APP for admins only.
   */
  fspStatusCode?: string | null;
  /** Whether the signed-in user has the FSPTS_ADMINISTRATOR role. */
  isAdmin?: boolean;
  /**
   * Read-only role (Reviewer / View-Only) — suppresses the "Edit
   * licences" affordance entirely, regardless of status or admin.
   */
  readOnly?: boolean;
  /** Parent-bumped counter that forces a refetch on Submit/Extend/etc. */
  refreshKey?: number;
}

const VARIANT_TITLE: Record<Props['variant'], string> = {
  fdu: 'Forest Development Units (FDU)',
};

const MAP_VIEWER_URL = env.VITE_MAP_VIEWER_URL ?? '';
const MAP_VIEWER_LAYERS = '1417,1418,1419,1420';

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Thin-stroke folded-map glyph for the empty state. Carbon's filled Map
// reads too heavy at pictogram size; a stroked SVG with non-scaling-stroke
// keeps the lines a crisp ~1.5px at any rendered size.
const EmptyMapIcon = () => (
  <svg
    width="112"
    height="112"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 8l8-3 8 3 8-3v19l-8 3-8-3-8 3z" vectorEffect="non-scaling-stroke" />
    <path d="M12 5v19M20 8v19" vectorEffect="non-scaling-stroke" />
  </svg>
);

type SortDir = 'ASC' | 'DESC';

const MapTab: FC<Props> = ({
  fspId,
  amendmentNumber,
  variant,
  fspStatusCode,
  isAdmin,
  readOnly,
  refreshKey,
}) => {
  const [extent, setExtent] = useState<string | null>(null);
  const [extentLoading, setExtentLoading] = useState(false);
  const [extentError, setExtentError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // FDU list loads for the FDU variant.
  const [fduList, setFduList] = useState<FspFduList | null>(null);
  const [fduLoading, setFduLoading] = useState(false);
  // Frontend sort on FDU name, ascending by default with the indicator
  // shown; clicking the header toggles the direction.
  const [sortDir, setSortDir] = useState<SortDir>('ASC');

  // Edit-licences modal target — null when closed.
  const [editTarget, setEditTarget] = useState<
    { fduId: string; fduName: string; licences: string } | null
  >(null);

  const { display } = useNotification();
  const title = VARIANT_TITLE[variant];

  // Status gate matches the backend: DFT writable by submitters, APP by
  // admins only, everything else read-only. We don't try to detect "is
  // this user a submitter" on the client — the read path's tombstone
  // gate already rejected unauthorised users before the table loaded.
  const canEditLicences =
    !readOnly &&
    variant === 'fdu' &&
    (fspStatusCode === 'DFT' ||
      (fspStatusCode === 'APP' && !!isAdmin));

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setExtentLoading(true);
    setExtentError(null);
    getFspExtent(fspId, amendmentNumber || '0')
      .then((res) => {
        if (!cancelled) setExtent(res.extent ?? null);
      })
      .catch((e) => {
        if (!cancelled)
          setExtentError(e instanceof Error ? e.message : 'Extent load failed.');
      })
      .finally(() => {
        if (!cancelled) setExtentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, amendmentNumber, refreshKey]);

  useEffect(() => {
    if (!fspId || variant !== 'fdu') return;
    let cancelled = false;
    setFduLoading(true);
    getFspFduList(fspId)
      .then((res) => {
        if (!cancelled) setFduList(res);
      })
      .catch((e) => {
        if (!cancelled)
          display({
            kind: 'error',
            title: 'Unable to load FDUs',
            subtitle: e instanceof Error ? e.message : 'Unknown error',
            timeout: 7000,
          });
      })
      .finally(() => {
        if (!cancelled) setFduLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, variant, display, refreshKey]);

  /**
   * Opens the legacy arcmaps viewer in a new tab, scoped to the FSP's
   * MBR (or to a specific FDU if {@code rowExtent} is supplied — though
   * the proc doesn't currently give us per-FDU extents, so all rows
   * reuse the same bulk MBR for now).
   */
  const openMapView = (rowExtent?: string) => {
    if (!MAP_VIEWER_URL) {
      display({
        kind: 'error',
        title: 'Map View not configured',
        subtitle: 'Set VITE_MAP_VIEWER_URL.',
        timeout: 7000,
      });
      return;
    }
    const target = rowExtent ?? extent;
    if (!target) {
      display({
        kind: 'warning',
        title: 'No spatial data',
        subtitle: 'This FSP/amendment has no FDU geometry to map.',
        timeout: 6000,
      });
      return;
    }
    setOpening(true);
    const sep = MAP_VIEWER_URL.includes('?') ? '&' : '?';
    const url = `${MAP_VIEWER_URL}${sep}extent=${target}&catalogLayers=${MAP_VIEWER_LAYERS}`;
    const popup = window.open(url, '_blank');
    if (!popup) {
      display({
        kind: 'error',
        title: 'Pop-up blocked',
        subtitle: 'Allow pop-ups for this site to use Map View.',
        timeout: 7000,
      });
    }
    setOpening(false);
  };

  const showFduTable = variant === 'fdu';
  const sortedFdus = useMemo(() => {
    const list = fduList?.fdus ?? [];
    return [...list].sort((a, b) => {
      const cmp = (a.fduName ?? '').localeCompare(b.fduName ?? '', undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sortDir === 'ASC' ? cmp : -cmp;
    });
  }, [fduList, sortDir]);

  return (
    <>
      {/* FDU variant skips straight to the records table; the
          extent-only tile below is retained for any non-FDU variant. */}
      {!showFduTable && (
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">{title}</h2>
          </header>
          {extentLoading && (
            <div className="fsp-info__loading" role="status" aria-live="polite">
              <Loading description="Loading extent…" withOverlay={false} />
            </div>
          )}
          {extentError && <p className="fsp-info__error">{extentError}</p>}
          {!extentLoading && !extentError && (
            <dl className="fsp-info__field-list">
              <div className="fsp-info__field">
                <dt>Extent (MBR)</dt>
                <dd>{extent ?? 'No spatial data for this FSP/amendment.'}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      {showFduTable &&
        (fduLoading && !fduList ? (
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading FDUs…" withOverlay={false} />
          </div>
        ) : !fduList || fduList.fdus.length === 0 ? (
          <EmptyState
            icon={<EmptyMapIcon />}
            title="No FDUs for this FSP"
            body="FDU boundaries come from the spatial data (XML/GeoJSON) submitted for this FSP. None have been submitted for this version yet."
          />
        ) : (
          <>
          <header className="fsp-info__tile-header fsp-info__tile-header--tab">
            <h2 className="fsp-info__section-title fsp-info__section-title--icon">
              <Map size={20} />
              <span>{title}</span>
            </h2>
          </header>
          <div className="bordered-table fsp-info__fdu-table">
            <TableContainer>
              <Table size="md" useZebraStyles>
                <TableHead>
                  <TableRow>
                    <TableHeader
                      isSortable
                      isSortHeader
                      sortDirection={sortDir}
                      onClick={() => setSortDir((d) => (d === 'ASC' ? 'DESC' : 'ASC'))}
                    >
                      FDU name
                    </TableHeader>
                    <TableHeader>Licence</TableHeader>
                    <TableHeader>Actions</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedFdus.map((f, i) => (
                    <TableRow key={f.fduId ?? `row-${i}`}>
                      <TableCell>{dash(f.fduName)}</TableCell>
                      <TableCell>{dash(f.licences)}</TableCell>
                      <TableCell>
                        <div className="fsp-info__row-actions">
                          <Button
                            kind="ghost"
                            size="sm"
                            renderIcon={Launch}
                            onClick={() => openMapView()}
                            disabled={!extent || opening}
                          >
                            Map view
                          </Button>
                          {canEditLicences && f.fduId && (
                            <Button
                              kind="ghost"
                              size="sm"
                              renderIcon={Edit}
                              onClick={() =>
                                setEditTarget({
                                  fduId: f.fduId as string,
                                  fduName: f.fduName ?? '',
                                  licences: f.licences ?? '',
                                })
                              }
                            >
                              Edit licences
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
          </>
        ))}

      {editTarget && (
        <FduLicencesModal
          open={!!editTarget}
          fspId={fspId}
          fduId={editTarget.fduId}
          fduName={editTarget.fduName}
          initialLicences={editTarget.licences}
          onClose={() => setEditTarget(null)}
          onSaved={(licences) => {
            // Splice the refreshed licence list into the row in place
            // so the table reflects the change immediately. The next
            // tab switch re-fetches the proc-truth list anyway.
            setFduList((cur) => {
              if (!cur) return cur;
              return {
                ...cur,
                fdus: cur.fdus.map((f) =>
                  f.fduId === editTarget.fduId
                    ? { ...f, licences: licences.join(', ') }
                    : f,
                ),
              };
            });
          }}
        />
      )}
    </>
  );
};

export default MapTab;
