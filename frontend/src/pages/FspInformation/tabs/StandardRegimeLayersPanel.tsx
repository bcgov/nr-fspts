import {
  DataTable,
  Loading,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from '@carbon/react';
import {type FC, useEffect, useMemo, useState} from 'react';

import {useNotification} from '@/context/notification/useNotification';
import {
  getStandardRegimeLayerDetail,
  type StandardRegimeLayer,
  type StandardRegimeLayerDetail,
} from '@/services/fspSearch';

interface Props {
  fspId: string;
  regimeId: string;
  layers: StandardRegimeLayer[];
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Pretty labels by proc layer code. Matches the legacy sub-tab text.
const LAYER_LABEL: Record<string, string> = {
  I: 'Single',
  '1': 'Layer 1 - Mature',
  '2': 'Layer 2 - Pole',
  '3': 'Layer 3 - Sapling',
  '4': 'Layer 4 - Regen',
};

const LayerDetailPanel: FC<{ fspId: string; regimeId: string; layer: StandardRegimeLayer }> = ({
  fspId,
  regimeId,
  layer,
}) => {
  const [detail, setDetail] = useState<StandardRegimeLayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { display } = useNotification();

  useEffect(() => {
    if (!layer.layerCode || !layer.layerId) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    getStandardRegimeLayerDetail(fspId, regimeId, layer.layerCode, layer.layerId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (cancelled) return;
        display({
          kind: 'error',
          title: 'Unable to load layer detail',
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
  }, [fspId, regimeId, layer.layerCode, layer.layerId, display]);

  if (loading && !detail) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading layer…" withOverlay={false} />
      </div>
    );
  }
  if (!detail) return <p>No layer data available.</p>;

  // Three-column density block mirrors the legacy layer table:
  //   col 1: Well Spaced Trees / ha    (target/min*/max stocking)
  //   col 2: Residual Basal Area (m2/ha)  (only one row populated)
  //   col 3: Post Spacing Density (st/ha)  (min/max spacing)
  const densityRows = [
    { label: 'Target', well: detail.targetStocking, basal: '', post: '' },
    { label: 'Min Horiz (m)', well: detail.minHorizontalDistance, basal: '', post: '' },
    { label: 'Min Pref', well: detail.minPrefStockingStandard, basal: '', post: '' },
    {
      label: 'Min',
      well: detail.minStockingStandard,
      basal: detail.residualBasalArea,
      post: detail.minPostSpacing,
    },
    { label: 'Max', well: '', basal: '', post: detail.maxPostSpacing },
  ];

  return (
    <div className="fsp-info__tab-panel">
      <section>
        <div className="bordered-table">
          <DataTable
            rows={densityRows.map((r, i) => ({
              id: `${r.label}-${i}`,
              label: r.label,
              well: dash(r.well),
              basal: dash(r.basal),
              post: dash(r.post),
            }))}
            headers={[
              { key: 'label', header: '' },
              { key: 'well', header: 'Well Spaced Trees / ha' },
              { key: 'basal', header: 'Residual Basal Area (m²/ha)' },
              { key: 'post', header: 'Post Spacing Density (st/ha)' },
            ]}
          >
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
                    {rows.map((row) => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value as string}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </div>
      </section>

      <dl className="fsp-info__field-list">
        <div className="fsp-info__field">
          <dt>Max Coniferous (st/ha)</dt>
          <dd>{dash(detail.maxConifer)}</dd>
        </div>
        <div className="fsp-info__field">
          <dt>Height Relative to Comp ({detail.treeSizeUnitCode === 'CM' ? 'cm' : '%'})</dt>
          <dd>{dash(detail.heightRelativeToComp)}</dd>
        </div>
      </dl>

      <section>
        <h3 className="fsp-info__section-title">Preferred Species</h3>
        {detail.preferredSpecies.length === 0 ? (
          <p>No preferred species.</p>
        ) : (
          <SpeciesTable rows={detail.preferredSpecies} idPrefix={`pref-${layer.layerCode}`} />
        )}
      </section>

      <section>
        <h3 className="fsp-info__section-title">Acceptable Species</h3>
        {detail.acceptableSpecies.length === 0 ? (
          <p>No acceptable species.</p>
        ) : (
          <SpeciesTable rows={detail.acceptableSpecies} idPrefix={`acc-${layer.layerCode}`} />
        )}
      </section>
    </div>
  );
};

const SpeciesTable: FC<{
  rows: StandardRegimeLayerDetail['preferredSpecies'];
  idPrefix: string;
}> = ({ rows, idPrefix }) => (
  <div className="bordered-table">
    <DataTable
      rows={rows.map((s, i) => ({
        id: `${idPrefix}-${s.code ?? i}`,
        species: dash(s.description ?? s.code),
        minHeight: dash(s.minHeight),
      }))}
      headers={[
        { key: 'species', header: 'Species' },
        { key: 'minHeight', header: 'Min Height' },
      ]}
    >
      {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
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
              {r.map((row) => (
                <TableRow {...getRowProps({ row })} key={row.id}>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.id}>{cell.value as string}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  </div>
);

/**
 * Renders the layer sub-tab strip + the active layer's detail panel.
 * Only layers the regime has data for are rendered (`layers` filtered
 * server-side from the Y flags in FSP_550_STDS_PROPOSAL).
 */
const StandardRegimeLayersPanel: FC<Props> = ({ fspId, regimeId, layers }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset to first tab when the regime changes (the parent already
  // remounts on regime change via its key, but defensive in case it
  // ever stops doing that).
  useEffect(() => {
    setActiveIndex(0);
  }, [regimeId]);

  // Defensive default — the parent passes detail.layers but if the
  // backend response is from a pre-deploy build that lacks the field,
  // it'd be undefined and crash the .filter() below. Only filter out
  // entries without a layerCode; a missing layerId still gets a tab
  // so the per-layer fetch can surface whatever data is there.
  const tabs = useMemo(
    () =>
      (layers ?? []).filter((l) => l.layerCode !== null) as Array<
        StandardRegimeLayer & { layerCode: string; layerId: string | null }
      >,
    [layers],
  );

  if (tabs.length === 0) {
    return <p>This regime has no layer data.</p>;
  }

  return (
    <div className="fsp-info__inner-tabs">
      <Tabs selectedIndex={activeIndex} onChange={({ selectedIndex }) => setActiveIndex(selectedIndex)}>
        <TabList aria-label="Standards regime layers" contained>
          {tabs.map((l) => (
            <Tab key={l.layerCode}>{LAYER_LABEL[l.layerCode] ?? `Layer ${l.layerCode}`}</Tab>
          ))}
        </TabList>
        <TabPanels>
          {tabs.map((l) => (
            <TabPanel key={l.layerCode}>
              <LayerDetailPanel fspId={fspId} regimeId={regimeId} layer={l} />
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>
    </div>
  );
};

export default StandardRegimeLayersPanel;
