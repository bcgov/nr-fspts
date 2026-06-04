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
import {Map as MapIcon} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

import {useNotification} from '@/context/notification/useNotification';
import {env} from '@/env';
import {type FspIdentifiedAreaList, getFspExtent, getFspIdentifiedAreas,} from '@/services/fspSearch';

interface Props {
  fspId: string;
  amendmentNumber: string;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const HEADERS = [
  { key: 'name', header: 'Identified Area Name' },
  { key: 'section', header: 'FRPA Section' },
  { key: 'actions', header: '' },
];

const MAP_VIEWER_URL = env.VITE_MAP_VIEWER_URL ?? '';
const MAP_VIEWER_LAYERS = '1417,1418,1419,1420';

/**
 * Identified Areas / Map tab — combines all three legislation-type
 * sub-tabs the legacy app rendered into one flat table with FRPA
 * Section as a column. Each row's Map View link reuses the FSP-level
 * MBR extent (the proc doesn't surface a per-area extent).
 */
const IdentifiedAreasTab: FC<Props> = ({ fspId, amendmentNumber }) => {
  const [list, setList] = useState<FspIdentifiedAreaList | null>(null);
  const [loading, setLoading] = useState(false);
  const [extent, setExtent] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const { display } = useNotification();

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    getFspIdentifiedAreas(fspId)
      .then((data) => {
        if (!cancelled) setList(data);
      })
      .catch((e) => {
        if (cancelled) return;
        display({
          kind: 'error',
          title: 'Unable to load identified areas',
          subtitle: e instanceof Error ? e.message : 'Unknown error',
          timeout: 7000,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, display]);

  // Lazy-fetch extent on mount so the per-row Map View button is
  // ready when the user clicks. Same pattern as MapTab.
  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    getFspExtent(fspId, amendmentNumber || '0')
      .then((res) => {
        if (!cancelled) setExtent(res.extent ?? null);
      })
      .catch(() => {
        // Non-fatal — per-row Map View buttons will stay disabled.
        if (!cancelled) setExtent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, amendmentNumber]);

  const openMapView = () => {
    if (!MAP_VIEWER_URL) {
      display({
        kind: 'error',
        title: 'Map View not configured',
        subtitle: 'Set VITE_MAP_VIEWER_URL.',
        timeout: 7000,
      });
      return;
    }
    if (!extent) {
      display({
        kind: 'warning',
        title: 'No spatial data',
        subtitle: 'This FSP/amendment has no geometry to map.',
        timeout: 6000,
      });
      return;
    }
    setOpening(true);
    const sep = MAP_VIEWER_URL.includes('?') ? '&' : '?';
    const url = `${MAP_VIEWER_URL}${sep}extent=${extent}&catalogLayers=${MAP_VIEWER_LAYERS}`;
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

  if (loading && !list) {
    return (
      <section className="fsp-info__tile fsp-info__tile--full">
        <div className="fsp-info__loading" role="status" aria-live="polite">
          <Loading description="Loading identified areas…" withOverlay={false} />
        </div>
      </section>
    );
  }

  const areas = list?.areas ?? [];
  const tableRows = areas.map((a, i) => ({
    id: a.identifiedAreaId ?? `row-${i}`,
    name: dash(a.identifiedAreaName),
    section: dash(a.legislationLabel),
    actions: '',
  }));

  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <h2 className="fsp-info__section-title">Identified Areas / Map</h2>
      </header>
      {areas.length === 0 ? (
        <p>No identified or declared areas on this FSP/amendment.</p>
      ) : (
        <div className="bordered-table">
          <DataTable rows={tableRows} headers={HEADERS}>
            {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
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
                    {r.map((row) => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                <Button
                                  kind="ghost"
                                  size="sm"
                                  renderIcon={MapIcon}
                                  onClick={openMapView}
                                  disabled={!extent || opening}
                                >
                                  Map View
                                </Button>
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
  );
};

export default IdentifiedAreasTab;
