import {
  Button,
  DataTable,
  DatePicker,
  DatePickerInput,
  Loading,
  RadioButton,
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
} from '@carbon/react';
import {Add, Copy, Edit, TrashCan} from '@carbon/icons-react';
import {type FC, useEffect, useRef, useState} from 'react';

import BgcZoneSearchModal from '@/components/BgcZoneSearchModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import {StandardsSearchIcon} from '@/components/Layout/navIcons';
import {StatusTag} from '@/components/StatusTag/StatusTag';
import {useNotification} from '@/context/notification/useNotification';
import type {BgcSearchResult} from '@/services/bgcSearch';
import {
  addStandardRegimeBgcZone,
  deleteStandardRegimeBgcZone,
  getStandardRegimeDetail,
  type StandardRegimeBgcZone,
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
  noRegenEarlyOffsetYrs: string;
  noRegenLateOffsetYrs: string;
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
  noRegenEarlyOffsetYrs: d.noRegenEarlyOffsetYrs ?? '',
  noRegenLateOffsetYrs: d.noRegenLateOffsetYrs ?? '',
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
  // Each obligation row owns a distinct pair of offset columns and only
  // the selected row's inputs are editable:
  //   - "Regen obligations" → Regen (delay) / Early / Late free-growing.
  //       Regen and Late are required; Early is optional.
  //   - "No regen obligations" → Early / Late only (Regen is N/A).
  //       Both are optional but must be whole numbers when supplied.
  if (form.regenObligation) {
    if (!form.regenDelayOffsetYrs.trim()) {
      errs.regenDelayOffsetYrs = 'Required.';
    } else if (!nonNeg(form.regenDelayOffsetYrs)) {
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
  } else {
    if (form.noRegenEarlyOffsetYrs && !nonNeg(form.noRegenEarlyOffsetYrs)) {
      errs.noRegenEarlyOffsetYrs = 'Whole number ≥ 0.';
    }
    if (form.noRegenLateOffsetYrs && !nonNeg(form.noRegenLateOffsetYrs)) {
      errs.noRegenLateOffsetYrs = 'Whole number ≥ 0.';
    }
  }
  return errs;
};

const toOverviewPayload = (form: OverviewFormState): StandardRegimeOverviewUpdate => ({
  standardsRegimeName: form.standardsRegimeName.trim(),
  standardsObjective: form.standardsObjective.trim() || null,
  geographicDescription: form.geographicDescription.trim() || null,
  additionalStandards: form.additionalStandards.trim() || null,
  // Regulation (SILV_STATUTE_CODE) is not editable — omitted so the
  // service round-trips the current value. Effective date likewise.
  expiryDate: form.expiryDate || null,
  regenObligationInd: form.regenObligation ? 'Y' : 'N',
  // Each obligation row owns its own offset columns. Only send the
  // selected row's values; clear the other row's (empty string, not
  // null) so stale numbers don't linger in the read-only view.
  regenDelayOffsetYrs: form.regenObligation ? form.regenDelayOffsetYrs.trim() || null : '',
  freeGrowingEarlyOffsetYrs: form.regenObligation
    ? form.freeGrowingEarlyOffsetYrs.trim() || null
    : '',
  freeGrowingLateOffsetYrs: form.regenObligation
    ? form.freeGrowingLateOffsetYrs.trim() || null
    : '',
  noRegenEarlyOffsetYrs: form.regenObligation ? '' : form.noRegenEarlyOffsetYrs.trim() || null,
  noRegenLateOffsetYrs: form.regenObligation ? '' : form.noRegenLateOffsetYrs.trim() || null,
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
  /**
   * Whether the "Copy standard" action is available for this regime.
   * When true (and {@link onCopy} is provided) a Copy button renders in
   * the panel header; the parent owns the confirm dialog + persist.
   */
  canCopy?: boolean;
  onCopy?: () => void;
  /**
   * Whether the "Delete standard" action is available for this regime.
   * When true (and {@link onDelete} is provided) a red Delete button
   * renders in the panel header; the parent owns the confirm + persist.
   */
  canDelete?: boolean;
  onDelete?: () => void;
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
  canCopy = false,
  onCopy,
  canDelete = false,
  onDelete,
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
  // BGC Zones tab — zones are linked via the search picker and removed
  // via the per-row Delete; there's no inline edit (change a zone by
  // removing it and adding the correct one).
  //   Add → BgcZoneSearchModal (SIL52A-style search picker; posts
  //   immediately on select with no in-between form).
  const [bgcSearchOpen, setBgcSearchOpen] = useState(false);
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

  /**
   * Add path — the search modal hands back a row from SIL_52_BGC_SEARCH_V003.
   * Each row carries the full 7-field BEC tuple, so we persist all of it.
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
      <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
        <div
          className="fsp-info__detail-empty"
          role="status"
          aria-live="polite"
        >
          <Loading description="Loading standards detail…" withOverlay={false} />
        </div>
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--plain">
        <div className="fsp-info__detail-empty">
          Standards regime {regimeId} not found.
        </div>
      </section>
    );
  }

  // Standards ID + Status now live in the panel header; Version is in
  // the standards table; the regen / free-growing offsets render as
  // their own matrix below. What's left is the plain field grid.
  const overview: { label: string; value: string; newRow?: boolean }[] = [
    { label: 'Standards name', value: dash(detail.standardsRegimeName) },
    { label: 'Default standard', value: yesNo(detail.mofDefaultStandardInd) },
    { label: 'Submitted by', value: dash(detail.submittedByUserid) },
    // Effective date breaks to its own row, taking Expiry date with it.
    { label: 'Effective date', value: dash(detail.effectiveDate), newRow: true },
    { label: 'Expiry date', value: dash(detail.expiryDate) },
  ];

  return (
    <section className="fsp-info__tile fsp-info__tile--full fsp-info__tile--detail">
      <header className="fsp-info__detail-header">
        <div className="fsp-info__detail-heading">
          {/* Match the Information tab's "Plan details" heading: same
              regular-weight icon+title style, with the Stocking-standards
              nav icon used by the parent tab. */}
          <h2 className="fsp-info__section-title fsp-info__section-title--icon">
            <StandardsSearchIcon width={20} height={20} />
            <span>Standards ID: {dash(detail.standardsRegimeId)}</span>
          </h2>
          {detail.statusDescription && (
            <StatusTag status={detail.statusDescription} />
          )}
        </div>
        {((canCopy && onCopy) || (canDelete && onDelete)) && (
          <div className="fsp-info__detail-actions">
            {canCopy && onCopy && (
              <Button kind="tertiary" size="sm" renderIcon={Copy} onClick={onCopy}>
                Copy standard
              </Button>
            )}
            {canDelete && onDelete && (
              <Button
                kind="danger--tertiary"
                size="sm"
                renderIcon={TrashCan}
                onClick={onDelete}
              >
                Delete standard
              </Button>
            )}
          </div>
        )}
      </header>
      {detail.fspIdList && (
        <p className="fsp-info__detail-subtitle">FSP ID: {detail.fspIdList}</p>
      )}
      <div className="fsp-info__inner-tabs fsp-info__inner-tabs--detail">
      <Tabs>
        <TabList aria-label="Standards regime sections">
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
                    Edit overview
                  </Button>
                </div>
              )}

              {editingOverview && overviewForm ? (
                <>
                  {/* Standards name on its own row; Expiry date drops to
                      the next row (Effective date is not editable here). */}
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
                  </div>
                  <div className="fsp-info__edit-grid">
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
                  </div>

                  {/* Editable regen / free-growing matrix. The radio picks
                      the obligation type; the Regen / Early / Late offset
                      inputs are only active on the "Regen obligations"
                      row. */}
                  <div className="bordered-table fsp-info__regen-table fsp-info__regen-table--editing">
                    <Table size="sm">
                      <TableHead>
                        <TableRow>
                          <TableHeader aria-label="Obligation" />
                          <TableHeader>Regen</TableHeader>
                          <TableHeader>Early</TableHeader>
                          <TableHeader>Late</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>
                            <RadioButton
                              id="edit-ssRegen-yes"
                              name="edit-ssRegenObligation"
                              labelText="Regen obligations"
                              checked={overviewForm.regenObligation}
                              disabled={savingOverview}
                              onChange={() =>
                                setOverviewField('regenObligation', true)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            {overviewForm.regenObligation ? (
                              <TextInput
                                id="edit-ssRegenDelayYrs"
                                labelText="Regen years"
                                hideLabel
                                size="sm"
                                maxLength={2}
                                inputMode="numeric"
                                value={overviewForm.regenDelayOffsetYrs}
                                invalid={!!overviewErrors.regenDelayOffsetYrs}
                                invalidText={overviewErrors.regenDelayOffsetYrs}
                                disabled={savingOverview}
                                onChange={(e) =>
                                  setOverviewField('regenDelayOffsetYrs', e.target.value)
                                }
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {overviewForm.regenObligation ? (
                              <TextInput
                                id="edit-ssFgEarlyYrs"
                                labelText="Early years"
                                hideLabel
                                size="sm"
                                maxLength={2}
                                inputMode="numeric"
                                value={overviewForm.freeGrowingEarlyOffsetYrs}
                                invalid={!!overviewErrors.freeGrowingEarlyOffsetYrs}
                                invalidText={overviewErrors.freeGrowingEarlyOffsetYrs}
                                disabled={savingOverview}
                                onChange={(e) =>
                                  setOverviewField('freeGrowingEarlyOffsetYrs', e.target.value)
                                }
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {overviewForm.regenObligation ? (
                              <TextInput
                                id="edit-ssFgLateYrs"
                                labelText="Late years"
                                hideLabel
                                size="sm"
                                maxLength={2}
                                inputMode="numeric"
                                value={overviewForm.freeGrowingLateOffsetYrs}
                                invalid={!!overviewErrors.freeGrowingLateOffsetYrs}
                                invalidText={overviewErrors.freeGrowingLateOffsetYrs}
                                disabled={savingOverview}
                                onChange={(e) =>
                                  setOverviewField('freeGrowingLateOffsetYrs', e.target.value)
                                }
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            <RadioButton
                              id="edit-ssRegen-no"
                              name="edit-ssRegenObligation"
                              labelText="No regen obligations"
                              checked={!overviewForm.regenObligation}
                              disabled={savingOverview}
                              onChange={() =>
                                setOverviewField('regenObligation', false)
                              }
                            />
                          </TableCell>
                          {/* Regen (delay) doesn't apply to the no-obligation
                              case — only Early / Late are captured. */}
                          <TableCell>—</TableCell>
                          <TableCell>
                            {!overviewForm.regenObligation ? (
                              <TextInput
                                id="edit-ssNoRegenEarlyYrs"
                                labelText="Early years"
                                hideLabel
                                size="sm"
                                maxLength={2}
                                inputMode="numeric"
                                value={overviewForm.noRegenEarlyOffsetYrs}
                                invalid={!!overviewErrors.noRegenEarlyOffsetYrs}
                                invalidText={overviewErrors.noRegenEarlyOffsetYrs}
                                disabled={savingOverview}
                                onChange={(e) =>
                                  setOverviewField('noRegenEarlyOffsetYrs', e.target.value)
                                }
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {!overviewForm.regenObligation ? (
                              <TextInput
                                id="edit-ssNoRegenLateYrs"
                                labelText="Late years"
                                hideLabel
                                size="sm"
                                maxLength={2}
                                inputMode="numeric"
                                value={overviewForm.noRegenLateOffsetYrs}
                                invalid={!!overviewErrors.noRegenLateOffsetYrs}
                                invalidText={overviewErrors.noRegenLateOffsetYrs}
                                disabled={savingOverview}
                                onChange={(e) =>
                                  setOverviewField('noRegenLateOffsetYrs', e.target.value)
                                }
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <TextArea
                    id="edit-ssObjective"
                    labelText="Objective"
                    value={overviewForm.standardsObjective}
                    enableCounter
                    maxCount={OVERVIEW_MAX.standardsObjective}
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
                    labelText="Geographic"
                    value={overviewForm.geographicDescription}
                    enableCounter
                    maxCount={OVERVIEW_MAX.geographicDescription}
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
                    enableCounter
                    maxCount={OVERVIEW_MAX.additionalStandards}
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
                      {savingOverview ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <dl className="fsp-info__field-list fsp-info__field-list--overview">
                    {overview.map((f) => (
                      <div
                        key={f.label}
                        className={
                          f.newRow
                            ? 'fsp-info__field fsp-info__field--new-row'
                            : 'fsp-info__field'
                        }
                      >
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {/* Regen / free-growing offset matrix: the "Regen
                      obligations" row carries the regen-delay + free-
                      growing offsets; "No regen obligations" carries the
                      no-regen offsets. */}
                  <div className="bordered-table fsp-info__regen-table">
                    <Table size="sm">
                      <TableHead>
                        <TableRow>
                          <TableHeader aria-label="Obligation" />
                          <TableHeader>Regen</TableHeader>
                          <TableHeader>Early</TableHeader>
                          <TableHeader>Late</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>Regen obligations</TableCell>
                          <TableCell>{dash(detail.regenDelayOffsetYrs)}</TableCell>
                          <TableCell>{dash(detail.freeGrowingEarlyOffsetYrs)}</TableCell>
                          <TableCell>{dash(detail.freeGrowingLateOffsetYrs)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>No regen obligations</TableCell>
                          <TableCell>—</TableCell>
                          <TableCell>{dash(detail.noRegenEarlyOffsetYrs)}</TableCell>
                          <TableCell>{dash(detail.noRegenLateOffsetYrs)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {detail.standardsObjective && (
                    <div>
                      <h3 className="fsp-info__section-title">Objective</h3>
                      <p>{detail.standardsObjective}</p>
                    </div>
                  )}
                  {detail.geographicDescription && (
                    <div>
                      <h3 className="fsp-info__section-title">Geographic</h3>
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
                      { key: 'number', header: 'Client number' },
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
                    Add existing BGC zone
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
                          <TableHeader>Site phase</TableHeader>
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
