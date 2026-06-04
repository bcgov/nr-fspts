import {
  Button,
  DataTable,
  DatePicker,
  DatePickerInput,
  Loading,
  NumberInput,
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
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react';
import {Download, Edit} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

import {useNotification} from '@/context/notification/useNotification';
import {
  downloadStandardRegimeAttachment,
  getStandardRegimeDetail,
  type StandardRegimeDetail,
  type StandardRegimeOverviewUpdate,
  updateStandardRegimeOverview,
} from '@/services/fspSearch';

import StandardRegimeLayersPanel from './StandardRegimeLayersPanel';

// ─── Overview-tab edit form ─────────────────────────────────────────

interface OverviewFormState {
  standardsRegimeName: string;
  standardsObjective: string;
  geographicDescription: string;
  additionalStandards: string;
  effectiveDate: string;
  expiryDate: string;
  regenObligation: boolean;
  regenDelayOffsetYrs: string;
  freeGrowingEarlyOffsetYrs: string;
  freeGrowingLateOffsetYrs: string;
}

const createOverviewForm = (d: StandardRegimeDetail): OverviewFormState => ({
  standardsRegimeName: d.standardsRegimeName ?? '',
  standardsObjective: d.standardsObjective ?? '',
  geographicDescription: d.geographicDescription ?? '',
  additionalStandards: d.additionalStandards ?? '',
  effectiveDate: d.effectiveDate ?? '',
  expiryDate: d.expiryDate ?? '',
  regenObligation: d.regenObligationInd === 'Y',
  regenDelayOffsetYrs: d.regenDelayOffsetYrs ?? '',
  freeGrowingEarlyOffsetYrs: d.freeGrowingEarlyOffsetYrs ?? '',
  freeGrowingLateOffsetYrs: d.freeGrowingLateOffsetYrs ?? '',
});

const OVERVIEW_MAX = {
  standardsRegimeName: 120,
  standardsObjective: 2000,
  geographicDescription: 2000,
  additionalStandards: 4000,
} as const;

type OverviewErrors = Partial<Record<keyof OverviewFormState, string>>;

const validateOverview = (form: OverviewFormState): OverviewErrors => {
  const errs: OverviewErrors = {};
  if (!form.standardsRegimeName.trim()) {
    errs.standardsRegimeName = 'Name is required.';
  } else if (form.standardsRegimeName.length > OVERVIEW_MAX.standardsRegimeName) {
    errs.standardsRegimeName = `Max ${OVERVIEW_MAX.standardsRegimeName} characters.`;
  }
  if (form.standardsObjective.length > OVERVIEW_MAX.standardsObjective) {
    errs.standardsObjective = `Max ${OVERVIEW_MAX.standardsObjective} characters.`;
  }
  if (form.geographicDescription.length > OVERVIEW_MAX.geographicDescription) {
    errs.geographicDescription = `Max ${OVERVIEW_MAX.geographicDescription} characters.`;
  }
  if (form.additionalStandards.length > OVERVIEW_MAX.additionalStandards) {
    errs.additionalStandards = `Max ${OVERVIEW_MAX.additionalStandards} characters.`;
  }
  const nonNeg = (s: string) => /^\d+$/.test(s);
  if (form.regenDelayOffsetYrs && !nonNeg(form.regenDelayOffsetYrs)) {
    errs.regenDelayOffsetYrs = 'Whole number ≥ 0.';
  }
  if (form.freeGrowingEarlyOffsetYrs && !nonNeg(form.freeGrowingEarlyOffsetYrs)) {
    errs.freeGrowingEarlyOffsetYrs = 'Whole number ≥ 0.';
  }
  if (form.freeGrowingLateOffsetYrs && !nonNeg(form.freeGrowingLateOffsetYrs)) {
    errs.freeGrowingLateOffsetYrs = 'Whole number ≥ 0.';
  }
  return errs;
};

const toOverviewPayload = (form: OverviewFormState): StandardRegimeOverviewUpdate => ({
  standardsRegimeName: form.standardsRegimeName.trim(),
  standardsObjective: form.standardsObjective.trim() || null,
  geographicDescription: form.geographicDescription.trim() || null,
  additionalStandards: form.additionalStandards.trim() || null,
  effectiveDate: form.effectiveDate || null,
  expiryDate: form.expiryDate || null,
  regenObligationInd: form.regenObligation ? 'Y' : 'N',
  regenDelayOffsetYrs: form.regenDelayOffsetYrs.trim() || null,
  freeGrowingEarlyOffsetYrs: form.freeGrowingEarlyOffsetYrs.trim() || null,
  freeGrowingLateOffsetYrs: form.freeGrowingLateOffsetYrs.trim() || null,
});

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Overview-tab edit state. Each inner tab gets its own toggle so a
  // save on Overview doesn't blow away the read-only context the user
  // had open on, say, Layers. Form state is null until the user clicks
  // Edit — at that point we snapshot the current detail.
  const [editingOverview, setEditingOverview] = useState(false);
  const [overviewForm, setOverviewForm] = useState<OverviewFormState | null>(null);
  const [overviewErrors, setOverviewErrors] = useState<OverviewErrors>({});
  const [savingOverview, setSavingOverview] = useState(false);

  const handleDownload = async (attachmentId: string, fallbackName: string) => {
    if (downloadingId) return;
    setDownloadingId(attachmentId);
    try {
      await downloadStandardRegimeAttachment(
        fspId,
        regimeId,
        attachmentId,
        fallbackName,
      );
    } catch (e) {
      display({
        kind: 'error',
        title: 'Download failed',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 7000,
      });
    } finally {
      setDownloadingId(null);
    }
  };
  const { display } = useNotification();

  useEffect(() => {
    if (!fspId || !regimeId) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    // Exit any in-flight edit when the regime/amendment changes — the
    // form snapshot would be stale and could quietly write the wrong
    // regime's values into the SAVE payload.
    setEditingOverview(false);
    setOverviewForm(null);
    setOverviewErrors({});
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

  // Keep the form synced with the detail when not actively editing
  // (post-save refresh, regime switch). When editing, never overwrite
  // — the user's in-flight typing would vanish.
  useEffect(() => {
    if (!editingOverview && detail) {
      setOverviewForm(createOverviewForm(detail));
      setOverviewErrors({});
    }
  }, [detail, editingOverview]);

  const handleOverviewEdit = () => {
    if (!detail) return;
    setOverviewForm(createOverviewForm(detail));
    setOverviewErrors({});
    setEditingOverview(true);
  };

  const handleOverviewCancel = () => {
    if (detail) setOverviewForm(createOverviewForm(detail));
    setOverviewErrors({});
    setEditingOverview(false);
  };

  const handleOverviewSave = async () => {
    if (!overviewForm) return;
    const found = validateOverview(overviewForm);
    if (Object.keys(found).length > 0) {
      setOverviewErrors(found);
      return;
    }
    setSavingOverview(true);
    try {
      const updated = await updateStandardRegimeOverview(
        fspId,
        regimeId,
        amendmentNumber || undefined,
        toOverviewPayload(overviewForm),
      );
      setDetail(updated);
      setEditingOverview(false);
      display({
        kind: 'success',
        title: 'Standards overview updated.',
        timeout: 7000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save standards overview',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSavingOverview(false);
    }
  };

  const setOverviewField = <K extends keyof OverviewFormState>(
    key: K,
    value: OverviewFormState[K],
  ) => {
    setOverviewForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (overviewErrors[key]) {
      setOverviewErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

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
              {!editingOverview && (
                <div className="fsp-info__tab-actions">
                  <Button
                    kind="primary"
                    size="sm"
                    renderIcon={Edit}
                    onClick={handleOverviewEdit}
                  >
                    Edit
                  </Button>
                </div>
              )}

              {editingOverview && overviewForm ? (
                <>
                  <div className="fsp-info__edit-grid">
                    <TextInput
                      id="edit-ssRegimeName"
                      labelText="Standards Name"
                      value={overviewForm.standardsRegimeName}
                      maxLength={OVERVIEW_MAX.standardsRegimeName}
                      invalid={!!overviewErrors.standardsRegimeName}
                      invalidText={overviewErrors.standardsRegimeName}
                      disabled={savingOverview}
                      onChange={(e) =>
                        setOverviewField('standardsRegimeName', e.target.value)
                      }
                    />
                    <DatePicker
                      datePickerType="single"
                      dateFormat="Y-m-d"
                      value={overviewForm.effectiveDate || undefined}
                      onChange={(dates: Date[]) =>
                        setOverviewField(
                          'effectiveDate',
                          dates[0] ? toIsoDate(dates[0]) : '',
                        )
                      }
                    >
                      <DatePickerInput
                        id="edit-ssEffectiveDate"
                        placeholder="YYYY-MM-DD"
                        labelText="Effective Date"
                        disabled={savingOverview}
                      />
                    </DatePicker>
                    <DatePicker
                      datePickerType="single"
                      dateFormat="Y-m-d"
                      value={overviewForm.expiryDate || undefined}
                      onChange={(dates: Date[]) =>
                        setOverviewField(
                          'expiryDate',
                          dates[0] ? toIsoDate(dates[0]) : '',
                        )
                      }
                    >
                      <DatePickerInput
                        id="edit-ssExpiryDate"
                        placeholder="YYYY-MM-DD"
                        labelText="Expiry Date"
                        disabled={savingOverview}
                      />
                    </DatePicker>
                    <Toggle
                      id="edit-ssRegenObligation"
                      labelText="Regen Obligation"
                      labelA="No"
                      labelB="Yes"
                      toggled={overviewForm.regenObligation}
                      disabled={savingOverview}
                      onToggle={(v) => setOverviewField('regenObligation', v)}
                    />
                    <NumberInput
                      id="edit-ssRegenDelayYrs"
                      label="Regen Delay (yrs)"
                      min={0}
                      max={99}
                      allowEmpty
                      hideSteppers
                      value={
                        overviewForm.regenDelayOffsetYrs === ''
                          ? ''
                          : Number(overviewForm.regenDelayOffsetYrs)
                      }
                      invalid={!!overviewErrors.regenDelayOffsetYrs}
                      invalidText={overviewErrors.regenDelayOffsetYrs}
                      disabled={savingOverview}
                      onChange={(_e, { value }) =>
                        setOverviewField(
                          'regenDelayOffsetYrs',
                          value === '' ? '' : String(value),
                        )
                      }
                    />
                    <NumberInput
                      id="edit-ssFgEarlyYrs"
                      label="Free Growing Early (yrs)"
                      min={0}
                      max={99}
                      allowEmpty
                      hideSteppers
                      value={
                        overviewForm.freeGrowingEarlyOffsetYrs === ''
                          ? ''
                          : Number(overviewForm.freeGrowingEarlyOffsetYrs)
                      }
                      invalid={!!overviewErrors.freeGrowingEarlyOffsetYrs}
                      invalidText={overviewErrors.freeGrowingEarlyOffsetYrs}
                      disabled={savingOverview}
                      onChange={(_e, { value }) =>
                        setOverviewField(
                          'freeGrowingEarlyOffsetYrs',
                          value === '' ? '' : String(value),
                        )
                      }
                    />
                    <NumberInput
                      id="edit-ssFgLateYrs"
                      label="Free Growing Late (yrs)"
                      min={0}
                      max={99}
                      allowEmpty
                      hideSteppers
                      value={
                        overviewForm.freeGrowingLateOffsetYrs === ''
                          ? ''
                          : Number(overviewForm.freeGrowingLateOffsetYrs)
                      }
                      invalid={!!overviewErrors.freeGrowingLateOffsetYrs}
                      invalidText={overviewErrors.freeGrowingLateOffsetYrs}
                      disabled={savingOverview}
                      onChange={(_e, { value }) =>
                        setOverviewField(
                          'freeGrowingLateOffsetYrs',
                          value === '' ? '' : String(value),
                        )
                      }
                    />
                  </div>

                  <TextArea
                    id="edit-ssObjective"
                    labelText="Objective"
                    value={overviewForm.standardsObjective}
                    maxLength={OVERVIEW_MAX.standardsObjective}
                    rows={3}
                    invalid={!!overviewErrors.standardsObjective}
                    invalidText={overviewErrors.standardsObjective}
                    disabled={savingOverview}
                    onChange={(e) =>
                      setOverviewField('standardsObjective', e.target.value)
                    }
                  />
                  <TextArea
                    id="edit-ssGeoDesc"
                    labelText="Geographic Description"
                    value={overviewForm.geographicDescription}
                    maxLength={OVERVIEW_MAX.geographicDescription}
                    rows={3}
                    invalid={!!overviewErrors.geographicDescription}
                    invalidText={overviewErrors.geographicDescription}
                    disabled={savingOverview}
                    onChange={(e) =>
                      setOverviewField('geographicDescription', e.target.value)
                    }
                  />
                  <TextArea
                    id="edit-ssAdditional"
                    labelText="Additional Standards"
                    value={overviewForm.additionalStandards}
                    maxLength={OVERVIEW_MAX.additionalStandards}
                    rows={4}
                    invalid={!!overviewErrors.additionalStandards}
                    invalidText={overviewErrors.additionalStandards}
                    disabled={savingOverview}
                    onChange={(e) =>
                      setOverviewField('additionalStandards', e.target.value)
                    }
                  />

                  <div className="fsp-info__form-actions">
                    <Button
                      kind="secondary"
                      size="sm"
                      disabled={savingOverview}
                      onClick={handleOverviewCancel}
                    >
                      Cancel
                    </Button>
                    <Button
                      kind="primary"
                      size="sm"
                      disabled={savingOverview}
                      onClick={handleOverviewSave}
                    >
                      {savingOverview ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
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
                </>
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
                      actions: '',
                      __attachmentId: a.attachmentId,
                      __fileName: a.attachmentName,
                    }))}
                    headers={[
                      { key: 'description', header: 'Description' },
                      { key: 'name', header: 'File Name' },
                      { key: 'mime', header: 'Type' },
                      { key: 'size', header: 'Size (KB)' },
                      { key: 'actions', header: '' },
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
                            {rows.map((row) => {
                              const source = detail.attachments.find(
                                (a, i) => (a.attachmentId ?? `row-${i}`) === row.id,
                              );
                              const attachmentId = source?.attachmentId ?? null;
                              const fileName = source?.attachmentName ?? row.id;
                              const isDownloading = downloadingId === attachmentId;
                              return (
                                <TableRow {...getRowProps({ row })} key={row.id}>
                                  {row.cells.map((cell) => {
                                    if (cell.info.header === 'actions') {
                                      return (
                                        <TableCell key={cell.id}>
                                          {attachmentId ? (
                                            <Button
                                              kind="ghost"
                                              size="sm"
                                              renderIcon={Download}
                                              iconDescription={
                                                isDownloading ? 'Downloading…' : 'Download'
                                              }
                                              hasIconOnly
                                              disabled={isDownloading}
                                              onClick={() =>
                                                void handleDownload(attachmentId, fileName)
                                              }
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
