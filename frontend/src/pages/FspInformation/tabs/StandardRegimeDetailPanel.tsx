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
import {Add, Edit, TrashCan} from '@carbon/icons-react';
import {type FC, useEffect, useRef, useState} from 'react';

import BgcZoneEditModal from '@/components/BgcZoneEditModal';
import BgcZoneSearchModal from '@/components/BgcZoneSearchModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import {useNotification} from '@/context/notification/useNotification';
import type {BgcSearchResult} from '@/services/bgcSearch';
import {
  addStandardRegimeBgcZone,
  deleteStandardRegimeBgcZone,
  getStandardRegimeDetail,
  type StandardRegimeBgcZone,
  type StandardRegimeBgcZoneUpsert,
  type StandardRegimeDetail,
  type StandardRegimeOverviewUpdate,
  updateStandardRegimeBgcZone,
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
  // Required-when rules (FRPA stocking-standards spec):
  //   - Regen Delay is required ONLY when Regen Obligation is on.
  //   - Free Growing Early is always optional.
  //   - Free Growing Late is always required.
  // Required checks come before format checks so a blank required
  // field shows "Required" rather than passing the format gate silently.
  if (form.regenObligation && !form.regenDelayOffsetYrs.trim()) {
    errs.regenDelayOffsetYrs = 'Required when Regen Obligation is on.';
  } else if (form.regenDelayOffsetYrs && !nonNeg(form.regenDelayOffsetYrs)) {
    errs.regenDelayOffsetYrs = 'Whole number ≥ 0.';
  }
  if (form.freeGrowingEarlyOffsetYrs && !nonNeg(form.freeGrowingEarlyOffsetYrs)) {
    errs.freeGrowingEarlyOffsetYrs = 'Whole number ≥ 0.';
  }
  if (!form.freeGrowingLateOffsetYrs.trim()) {
    errs.freeGrowingLateOffsetYrs = 'Required.';
  } else if (!nonNeg(form.freeGrowingLateOffsetYrs)) {
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
  /**
   * When true, all editing affordances (Overview Edit button,
   * Layer Edit button, species add/delete) are hidden. Defaults
   * to false so existing call sites stay editable.
   */
  readOnly?: boolean;
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
const StandardRegimeDetailPanel: FC<Props> = ({
  fspId,
  amendmentNumber,
  regimeId,
  readOnly = false,
}) => {
  const [detail, setDetail] = useState<StandardRegimeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // Overview-tab edit state. Each inner tab gets its own toggle so a
  // save on Overview doesn't blow away the read-only context the user
  // had open on, say, Layers. Form state is null until the user clicks
  // Edit — at that point we snapshot the current detail.
  const [editingOverview, setEditingOverview] = useState(false);
  // Focused on entering overview edit mode so the first field takes focus.
  const overviewNameRef = useRef<HTMLInputElement>(null);
  const [overviewForm, setOverviewForm] = useState<OverviewFormState | null>(null);
  const [overviewErrors, setOverviewErrors] = useState<OverviewErrors>({});
  const [savingOverview, setSavingOverview] = useState(false);
  // BGC Zones tab — Add and Edit are two separate dialogs:
  //   Add  → BgcZoneSearchModal (SIL52A-style search picker)
  //   Edit → BgcZoneEditModal (7 text inputs, pre-filled from the row)
  // Two open flags so closing one mid-fade can't blow away the other's
  // target. {@code bgcEditTarget} is always set for the edit path; the
  // search path posts immediately on select with no in-between form.
  const [bgcSearchOpen, setBgcSearchOpen] = useState(false);
  const [bgcEditOpen, setBgcEditOpen] = useState(false);
  const [bgcEditTarget, setBgcEditTarget] =
    useState<StandardRegimeBgcZone | null>(null);
  // Delete-confirm dialog state. Holds the row pending removal so the
  // ConfirmationModal can render its label + the actual DELETE can
  // resolve the right siteSeriesId + revisionCount on Confirm.
  const [bgcDeleteTarget, setBgcDeleteTarget] =
    useState<StandardRegimeBgcZone | null>(null);
  const { display } = useNotification();

  useEffect(() => {
    // fspId is optional — when blank, getStandardRegimeDetail routes
    // through the regime-only endpoint (used by the standards-search
    // modal). regimeId is the only hard requirement.
    if (!regimeId) return;
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

  // Focus the first field in the edit area when entering edit mode.
  useEffect(() => {
    if (editingOverview) overviewNameRef.current?.focus();
  }, [editingOverview]);

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

  const openBgcSearch = () => {
    setBgcSearchOpen(true);
  };

  const openBgcEdit = (row: StandardRegimeBgcZone) => {
    setBgcEditTarget(row);
    setBgcEditOpen(true);
  };

  /**
   * Add path — the search modal hands back a row from SIL_52_BGC_SEARCH_V003.
   * Each row carries the full 7-field BEC tuple, so we persist all of
   * it; site-series / phase / seral can still be tweaked afterwards
   * via the per-row Edit dialog if needed.
   */
  const handleBgcSearchSelect = async (row: BgcSearchResult) => {
    try {
      const updated = await addStandardRegimeBgcZone(
        fspId,
        regimeId,
        amendmentNumber || undefined,
        {
          bgcZoneCode: row.bgcZoneCode ?? null,
          bgcSubzoneCode: row.bgcSubzoneCode ?? null,
          bgcVariant: row.bgcVariant ?? null,
          bgcPhase: row.bgcPhase ?? null,
          becSiteSeriesCd: row.becSiteSeriesCd ?? null,
          becSiteSeriesPhaseCd: row.becSiteSeriesPhaseCd ?? null,
          becSeral: row.becSeral ?? null,
        },
      );
      setDetail(updated);
      display({
        kind: 'success',
        title: 'BGC zone added.',
        subtitle: [row.bgcZoneCode, row.bgcSubzoneCode, row.bgcVariant, row.bgcPhase]
          .filter(Boolean)
          .join(' - ') || undefined,
        timeout: 6000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to add BGC zone',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
      // Rethrow so BgcZoneSearchModal keeps itself open and the user
      // can retry without re-running the search.
      throw e;
    }
  };

  /** Edit path — only used by the per-row Edit dialog (search→add is
   *  immediate so it never routes through here). */
  const handleBgcEditSubmit = async (payload: StandardRegimeBgcZoneUpsert) => {
    if (!bgcEditTarget?.stdsRegimeSiteSeriesId) return;
    const updated = await updateStandardRegimeBgcZone(
      fspId,
      regimeId,
      bgcEditTarget.stdsRegimeSiteSeriesId,
      // The proc's optimistic-lock check needs the row's current
      // revision_count — empty would be read as INSERT.
      bgcEditTarget.revisionCount ?? '',
      amendmentNumber || undefined,
      payload,
    );
    setDetail(updated);
    display({
      kind: 'success',
      title: 'BGC zone updated.',
      timeout: 6000,
    });
  };

  const handleBgcDeleteConfirmed = async () => {
    if (!bgcDeleteTarget?.stdsRegimeSiteSeriesId) return;
    const updated = await deleteStandardRegimeBgcZone(
      fspId,
      regimeId,
      bgcDeleteTarget.stdsRegimeSiteSeriesId,
      bgcDeleteTarget.revisionCount ?? '',
      amendmentNumber || undefined,
    );
    setDetail(updated);
    display({
      kind: 'success',
      title: 'BGC zone removed.',
      subtitle: [
        bgcDeleteTarget.bgcZoneCode,
        bgcDeleteTarget.bgcSubzoneCode,
        bgcDeleteTarget.bgcVariant,
        bgcDeleteTarget.bgcPhase,
      ]
        .filter(Boolean)
        .join(' - ') || undefined,
      timeout: 6000,
    });
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
    { label: 'Standards name', value: dash(detail.standardsRegimeName) },
    { label: 'Status', value: dash(detail.statusDescription) },
    { label: 'Default standard', value: yesNo(detail.mofDefaultStandardInd) },
    { label: 'Regulation', value: dash(detail.regulationDescription) },
    { label: 'Effective date', value: dash(detail.effectiveDate) },
    { label: 'Expiry date', value: dash(detail.expiryDate) },
    { label: 'Amendment #', value: dash(detail.standardsAmendNumber) },
    { label: 'Submitted by', value: dash(detail.submittedByUserid) },
    {
      label: 'Regen obligation',
      value: yesNo(detail.regenObligationInd),
    },
    {
      label: 'Regen delay',
      value: dash(detail.regenDelayOffsetYrs),
    },
    {
      label: 'Free growing early',
      value: dash(detail.freeGrowingEarlyOffsetYrs),
    },
    {
      label: 'Free growing late',
      value: dash(detail.freeGrowingLateOffsetYrs),
    },
  ];

  return (
    <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--detail">
      <div className="fsp-info__inner-tabs">
      <Tabs>
        <TabList aria-label="Standards regime sections" contained>
          <Tab>Overview</Tab>
          <Tab>Layers</Tab>
          <Tab>Districts</Tab>
          <Tab>Agreement holders</Tab>
          <Tab>BGC zones</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="fsp-info__tab-panel">
              {!editingOverview && !readOnly && (
                <div className="fsp-info__tab-actions">
                  <Button
                    kind="tertiary"
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
                      ref={overviewNameRef}
                      labelText="Standards name"
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
                        labelText="Effective date"
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
                        labelText="Expiry date"
                        disabled={savingOverview}
                      />
                    </DatePicker>
                    <Toggle
                      id="edit-ssRegenObligation"
                      labelText="Regen obligation"
                      labelA="No"
                      labelB="Yes"
                      toggled={overviewForm.regenObligation}
                      disabled={savingOverview}
                      onToggle={(v) => setOverviewField('regenObligation', v)}
                    />
                    <NumberInput
                      id="edit-ssRegenDelayYrs"
                      // Asterisk follows Carbon's convention for
                      // required-field markers — added conditionally
                      // because Regen Delay is only required when the
                      // Regen Obligation toggle is on.
                      label={overviewForm.regenObligation ? 'Regen delay *' : 'Regen delay'}
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
                      label="Free growing early"
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
                      label="Free growing late *"
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
                    labelText="Geographic description"
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
                    labelText="Additional standards"
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
                      <h3 className="fsp-info__section-title">Geographic description</h3>
                      <p>{detail.geographicDescription}</p>
                    </div>
                  )}
                  {detail.additionalStandards && (
                    <div>
                      <h3 className="fsp-info__section-title">Additional standards</h3>
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
                amendmentNumber={amendmentNumber}
                layers={detail.layers}
                readOnly={readOnly}
                onDetailRefreshed={setDetail}
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
                    isSortable
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
                    isSortable
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
              {!readOnly && (
                <div className="fsp-info__tab-actions">
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Add}
                    onClick={openBgcSearch}
                  >
                    Add BGC zone
                  </Button>
                </div>
              )}
              {detail.bgcZones.length === 0 ? (
                <p>No BGC zones linked to this regime.</p>
              ) : (
                <div className="bordered-table">
                  <TableContainer>
                    <Table size="md" useZebraStyles>
                      <TableHead>
                        <TableRow>
                          <TableHeader>Zone</TableHeader>
                          <TableHeader>Subzone</TableHeader>
                          <TableHeader>Variant</TableHeader>
                          <TableHeader>Phase</TableHeader>
                          <TableHeader>Site series</TableHeader>
                          <TableHeader>Site series phase</TableHeader>
                          <TableHeader>Seral</TableHeader>
                          {!readOnly && (
                            <TableHeader style={{ width: '8rem' }} aria-label="Actions" />
                          )}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detail.bgcZones.map((b, i) => (
                          <TableRow
                            key={`${b.stdsRegimeSiteSeriesId ?? i}`}
                          >
                            <TableCell>{dash(b.bgcZoneCode)}</TableCell>
                            <TableCell>{dash(b.bgcSubzoneCode)}</TableCell>
                            <TableCell>{dash(b.bgcVariant)}</TableCell>
                            <TableCell>{dash(b.bgcPhase)}</TableCell>
                            <TableCell>{dash(b.becSiteSeriesCd)}</TableCell>
                            <TableCell>{dash(b.becSiteSeriesPhaseCd)}</TableCell>
                            <TableCell>{dash(b.becSeral)}</TableCell>
                            {!readOnly && (
                              <TableCell>
                                <Button
                                  kind="ghost"
                                  size="sm"
                                  renderIcon={Edit}
                                  iconDescription="Edit"
                                  hasIconOnly
                                  disabled={!b.stdsRegimeSiteSeriesId}
                                  onClick={() => openBgcEdit(b)}
                                />
                                <Button
                                  kind="danger--ghost"
                                  size="sm"
                                  renderIcon={TrashCan}
                                  disabled={
                                    !b.stdsRegimeSiteSeriesId || !b.revisionCount
                                  }
                                  onClick={() => setBgcDeleteTarget(b)}
                                >
                                  Delete
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </div>
              )}
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
      </div>
      <BgcZoneSearchModal
        open={bgcSearchOpen}
        onClose={() => setBgcSearchOpen(false)}
        onSelect={handleBgcSearchSelect}
      />
      <BgcZoneEditModal
        open={bgcEditOpen}
        value={bgcEditTarget}
        onClose={() => setBgcEditOpen(false)}
        onSubmit={handleBgcEditSubmit}
      />
      <ConfirmationModal
        open={bgcDeleteTarget != null}
        onClose={() => setBgcDeleteTarget(null)}
        heading="Delete BGC zone"
        confirmLabel="Delete"
        danger
        errorTitle="Failed to remove BGC zone"
        onConfirm={handleBgcDeleteConfirmed}
      >
        <p>
          Remove BGC zone{' '}
          <strong>
            {[
              bgcDeleteTarget?.bgcZoneCode,
              bgcDeleteTarget?.bgcSubzoneCode,
              bgcDeleteTarget?.bgcVariant,
              bgcDeleteTarget?.bgcPhase,
            ]
              .filter(Boolean)
              .join(' - ') || '(unnamed)'}
          </strong>{' '}
          from this regime? This cannot be undone.
        </p>
      </ConfirmationModal>
    </section>
  );
};

export default StandardRegimeDetailPanel;
