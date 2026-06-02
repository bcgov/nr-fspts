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
import {type FC, useEffect, useState} from 'react';

import {useNotification} from '@/context/notification/useNotification';
import {getStandardRegimeDetail, type StandardRegimeDetail,} from '@/services/fspSearch';

import StandardRegimeLayersPanel from './StandardRegimeLayersPanel';

interface Props {
  fspId: string;
  amendmentNumber: string;
  regimeId: string;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const yesNo = (value: string | null | undefined): string => {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return 'No';
  return '—';
};

/**
 * FSP250 "Standards View" detail panel — opens below the standards
 * table on row select. Loads via FSP_550_STDS_PROPOSAL.GET and shows
 * the regime's overview + related lists (districts, agreement
 * holders, BGC zones). Mirrors the REPT PropertyDetailTabs layout
 * pattern: nested Carbon Tabs inside a tile.
 */
const StandardRegimeDetailPanel: FC<Props> = ({ fspId, amendmentNumber, regimeId }) => {
  const [detail, setDetail] = useState<StandardRegimeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { display } = useNotification();

  useEffect(() => {
    if (!fspId || !regimeId) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    getStandardRegimeDetail(fspId, regimeId, amendmentNumber || undefined)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (cancelled) return;
        display({
          kind: 'error',
          title: 'Unable to load standards detail',
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
  }, [fspId, amendmentNumber, regimeId, display]);

  if (loading && !detail) {
    return (
      <section className="fsp-info__tile fsp-info__tile--full">
        <div className="fsp-info__loading" role="status" aria-live="polite">
          <Loading description="Loading standards detail…" withOverlay={false} />
        </div>
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="fsp-info__tile fsp-info__tile--full">
        <p className="fsp-info__placeholder">
          Standards regime {regimeId} not found.
        </p>
      </section>
    );
  }

  const overview: { label: string; value: string }[] = [
    { label: 'SS ID', value: dash(detail.standardsRegimeId) },
    { label: 'Standards Name', value: dash(detail.standardsRegimeName) },
    { label: 'Status', value: dash(detail.statusDescription) },
    { label: 'Default Standard', value: yesNo(detail.mofDefaultStandardInd) },
    { label: 'Regulation', value: dash(detail.regulationDescription) },
    { label: 'Effective Date', value: dash(detail.effectiveDate) },
    { label: 'Expiry Date', value: dash(detail.expiryDate) },
    { label: 'Amendment #', value: dash(detail.standardsAmendNumber) },
    { label: 'Submitted By', value: dash(detail.submittedByUserid) },
    {
      label: 'Regen Obligation',
      value: yesNo(detail.regenObligationInd),
    },
    {
      label: 'Regen Delay (yrs)',
      value: dash(detail.regenDelayOffsetYrs),
    },
    {
      label: 'Free Growing Early (yrs)',
      value: dash(detail.freeGrowingEarlyOffsetYrs),
    },
    {
      label: 'Free Growing Late (yrs)',
      value: dash(detail.freeGrowingLateOffsetYrs),
    },
  ];

  return (
    <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--detail">
      <header className="fsp-info__tile-header">
        <h2 className="fsp-info__section-title">
          Standards View — {dash(detail.standardsRegimeName)} (SS{' '}
          {dash(detail.standardsRegimeId)})
        </h2>
      </header>
      <div className="fsp-info__inner-tabs">
      <Tabs>
        <TabList aria-label="Standards regime sections" contained>
          <Tab>Overview</Tab>
          <Tab>Layers</Tab>
          <Tab>Districts</Tab>
          <Tab>Agreement Holders</Tab>
          <Tab>Attachments</Tab>
          <Tab>BGC Zones</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="fsp-info__tab-panel">
              <dl className="fsp-info__field-list">
                {overview.map((f) => (
                  <div key={f.label} className="fsp-info__field">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
              {detail.standardsObjective && (
                <div>
                  <h3 className="fsp-info__section-title">Objective</h3>
                  <p>{detail.standardsObjective}</p>
                </div>
              )}
              {detail.geographicDescription && (
                <div>
                  <h3 className="fsp-info__section-title">Geographic Description</h3>
                  <p>{detail.geographicDescription}</p>
                </div>
              )}
              {detail.additionalStandards && (
                <div>
                  <h3 className="fsp-info__section-title">Additional Standards</h3>
                  <p>{detail.additionalStandards}</p>
                </div>
              )}
            </div>
          </TabPanel>

          <TabPanel>
            <div className="fsp-info__tab-panel">
              <StandardRegimeLayersPanel
                fspId={fspId}
                regimeId={regimeId}
                layers={detail.layers}
              />
            </div>
          </TabPanel>

          <TabPanel>
            <div className="fsp-info__tab-panel">
              {detail.districts.length === 0 ? (
                <p>No districts linked to this regime.</p>
              ) : (
                <div className="bordered-table">
                  <DataTable
                    rows={detail.districts.map((d, i) => ({
                      id: d.orgUnitNo ?? `row-${i}`,
                      code: dash(d.orgUnitCode),
                      name: dash(d.orgUnitName),
                    }))}
                    headers={[
                      { key: 'code', header: 'Code' },
                      { key: 'name', header: 'Name' },
                    ]}
                  >
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
              )}
            </div>
          </TabPanel>

          <TabPanel>
            <div className="fsp-info__tab-panel">
              {detail.agreementHolders.length === 0 ? (
                <p>No agreement holders linked to this regime.</p>
              ) : (
                <div className="bordered-table">
                  <DataTable
                    rows={detail.agreementHolders.map((h, i) => ({
                      id: h.clientNumber ?? `row-${i}`,
                      number: dash(h.clientNumber),
                      acronym: dash(h.clientAcronym),
                      name: dash(h.clientName),
                    }))}
                    headers={[
                      { key: 'number', header: 'Client #' },
                      { key: 'acronym', header: 'Acronym' },
                      { key: 'name', header: 'Name' },
                    ]}
                  >
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
              )}
            </div>
          </TabPanel>

          <TabPanel>
            <div className="fsp-info__tab-panel">
              {detail.attachments.length === 0 ? (
                <p>No attachments on this regime.</p>
              ) : (
                <div className="bordered-table">
                  <DataTable
                    rows={detail.attachments.map((a, i) => ({
                      id: a.attachmentId ?? `row-${i}`,
                      description: dash(a.attachmentDescription),
                      name: dash(a.attachmentName),
                      mime: dash(a.mimeTypeCode),
                      size: dash(a.fileSize),
                    }))}
                    headers={[
                      { key: 'description', header: 'Description' },
                      { key: 'name', header: 'File Name' },
                      { key: 'mime', header: 'Type' },
                      { key: 'size', header: 'Size (KB)' },
                    ]}
                  >
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
              )}
            </div>
          </TabPanel>

          <TabPanel>
            <div className="fsp-info__tab-panel">
              {detail.bgcZones.length === 0 ? (
                <p>No BGC zones linked to this regime.</p>
              ) : (
                <div className="bordered-table">
                  <DataTable
                    rows={detail.bgcZones.map((b, i) => ({
                      id: `${b.bgcZoneCode}-${b.bgcSubzoneCode}-${b.bgcVariant}-${i}`,
                      zone: dash(b.bgcZoneCode),
                      subzone: dash(b.bgcSubzoneCode),
                      variant: dash(b.bgcVariant),
                      phase: dash(b.bgcPhase),
                      siteSeries: dash(b.becSiteSeriesCd),
                      seral: dash(b.becSeral),
                    }))}
                    headers={[
                      { key: 'zone', header: 'Zone' },
                      { key: 'subzone', header: 'Subzone' },
                      { key: 'variant', header: 'Variant' },
                      { key: 'phase', header: 'Phase' },
                      { key: 'siteSeries', header: 'Site Series' },
                      { key: 'seral', header: 'Seral' },
                    ]}
                  >
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
              )}
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
      </div>
    </section>
  );
};

export default StandardRegimeDetailPanel;
