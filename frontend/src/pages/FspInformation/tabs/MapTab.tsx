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
} from '@carbon/react';
import {Edit, Map as MapIcon} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

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
  fdu: 'FDU / Map',
};

const MAP_VIEWER_URL = env.VITE_MAP_VIEWER_URL ?? '';
const MAP_VIEWER_LAYERS = '1417,1418,1419,1420';

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const FDU_HEADERS = [
  { key: 'fduName', header: 'FDU name' },
  { key: 'licences', header: 'Licence' },
  { key: 'actions', header: '', isSortable: false },
];

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
  const fduRows =
    fduList?.fdus.map((f, i) => ({
      id: f.fduId ?? `row-${i}`,
      fduName: dash(f.fduName),
      licences: dash(f.licences),
      actions: '',
    })) ?? [];

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

      {showFduTable && (
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">FDU records</h2>
          </header>
          {fduLoading && !fduList ? (
            <div className="fsp-info__loading" role="status" aria-live="polite">
              <Loading description="Loading FDUs…" withOverlay={false} />
            </div>
          ) : !fduList || fduList.fdus.length === 0 ? (
            <p>No FDU records with spatial data for this FSP/amendment.</p>
          ) : (
            <div className="bordered-table">
              <DataTable rows={fduRows} headers={FDU_HEADERS} isSortable>
                {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="md" useZebraStyles>
                      <TableHead>
                        <TableRow>
                          {headers.map((h) => (
                            <TableHeader
                              {...getHeaderProps({ header: h })}
                              key={h.key}
                            >
                              {h.header}
                            </TableHeader>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {r.map((row) => (
                          <TableRow {...getRowProps({ row })} key={row.id}>
                            {row.cells.map((cell) => {
                              if (cell.info.header === 'actions') {
                                const sourceRow = fduList?.fdus.find(
                                  (f) => (f.fduId ?? '') === row.id,
                                );
                                return (
                                  <TableCell key={cell.id}>
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      renderIcon={MapIcon}
                                      onClick={() => openMapView()}
                                      disabled={!extent || opening}
                                    >
                                      Map view
                                    </Button>
                                    {canEditLicences && sourceRow?.fduId && (
                                      <Button
                                        kind="ghost"
                                        size="sm"
                                        renderIcon={Edit}
                                        onClick={() =>
                                          setEditTarget({
                                            fduId: sourceRow.fduId as string,
                                            fduName: sourceRow.fduName ?? '',
                                            licences: sourceRow.licences ?? '',
                                          })
                                        }
                                      >
                                        Edit licences
                                      </Button>
                                    )}
                                  </TableCell>
                                );
                              }
                              return (
                                <TableCell key={cell.id}>{cell.value as string}</TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            </div>
          )}
        </section>
      )}

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
