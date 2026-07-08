import {
  Button,
  DataTable,
  Loading,
  Modal,
  NumberInput,
  Select,
  SelectItem,
  Stack,
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
import {Add, Edit, TrashCan} from '@carbon/icons-react';
import {type FC, useCallback, useEffect, useMemo, useState} from 'react';

import ConfirmationModal from '@/components/ConfirmationModal';
import {useNotification} from '@/context/notification/useNotification';
import {
  addLayerSpecies,
  type CodeOption,
  convertStandardRegimeLayers,
  deleteLayerSpecies,
  getSilvTreeSpeciesCodes,
  getStandardRegimeDetail,
  getStandardRegimeLayerDetail,
  type StandardRegimeDetail,
  type StandardRegimeLayer,
  type StandardRegimeLayerDetail,
  type StandardRegimeLayerUpdate,
  type StandardRegimeSpecies,
  updateStandardRegimeLayer,
} from '@/services/fspSearch';

// Small Carbon spinner sized to fit a Button icon slot — matches the
// pattern used in AttachmentsTab / BgcZoneSearchModal so every dialog
// Save button shows the same in-flight affordance.
const SavingIcon = () => <Loading small withOverlay={false} description="" />;

// ─── Layer scalar-edit form ────────────────────────────────────────

interface LayerFormState {
  treeSizeUnitCode: string;
  targetStocking: string;
  minHorizontalDistance: string;
  minPrefStockingStandard: string;
  minStockingStandard: string;
  residualBasalArea: string;
  minPostSpacing: string;
  maxPostSpacing: string;
  maxConifer: string;
  heightRelativeToComp: string;
}

const createLayerForm = (d: StandardRegimeLayerDetail): LayerFormState => ({
  treeSizeUnitCode: d.treeSizeUnitCode ?? 'CM',
  targetStocking: d.targetStocking ?? '',
  minHorizontalDistance: d.minHorizontalDistance ?? '',
  minPrefStockingStandard: d.minPrefStockingStandard ?? '',
  minStockingStandard: d.minStockingStandard ?? '',
  residualBasalArea: d.residualBasalArea ?? '',
  minPostSpacing: d.minPostSpacing ?? '',
  maxPostSpacing: d.maxPostSpacing ?? '',
  maxConifer: d.maxConifer ?? '',
  heightRelativeToComp: d.heightRelativeToComp ?? '',
});

type LayerErrors = Partial<Record<keyof LayerFormState, string>>;

const isNonNegNumber = (s: string): boolean => /^\d+(\.\d+)?$/.test(s);

const validateLayer = (form: LayerFormState): LayerErrors => {
  const errs: LayerErrors = {};
  const numericFields: Array<keyof LayerFormState> = [
    'targetStocking',
    'minHorizontalDistance',
    'minPrefStockingStandard',
    'minStockingStandard',
    'residualBasalArea',
    'minPostSpacing',
    'maxPostSpacing',
    'maxConifer',
    'heightRelativeToComp',
  ];
  for (const key of numericFields) {
    const value = form[key];
    if (value && !isNonNegNumber(value)) {
      errs[key] = 'Non-negative number.';
    }
  }
  return errs;
};

const toLayerPayload = (form: LayerFormState): StandardRegimeLayerUpdate => ({
  treeSizeUnitCode: form.treeSizeUnitCode || null,
  targetStocking: form.targetStocking.trim() || null,
  minHorizontalDistance: form.minHorizontalDistance.trim() || null,
  minPrefStockingStandard: form.minPrefStockingStandard.trim() || null,
  minStockingStandard: form.minStockingStandard.trim() || null,
  residualBasalArea: form.residualBasalArea.trim() || null,
  minPostSpacing: form.minPostSpacing.trim() || null,
  maxPostSpacing: form.maxPostSpacing.trim() || null,
  maxConifer: form.maxConifer.trim() || null,
  heightRelativeToComp: form.heightRelativeToComp.trim() || null,
});

interface Props {
  fspId: string;
  regimeId: string;
  /** Forwarded into the convert-layers re-read; same noRecord trap as BGC. */
  amendmentNumber: string;
  layers: StandardRegimeLayer[];
  /** When true, hides the layer Edit button + species add/delete UI. */
  readOnly?: boolean;
  /** Called after a convert with the refreshed regime detail so the
   *  parent's layer flags + tabs reflect the new shape. */
  onDetailRefreshed?: (detail: StandardRegimeDetail) => void;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

/** First letter upper, rest lower. "POPLAR" → "Poplar". */
const capFirst = (s: string | null | undefined): string => {
  if (!s) return '';
  const t = s.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

/** "AC - Poplar" — falls back gracefully if either side is missing. */
const formatSpeciesLabel = (
  code: string | null | undefined,
  description: string | null | undefined,
): string => {
  const c = (code ?? '').trim();
  const d = capFirst(description);
  if (c && d) return `${c} - ${d}`;
  if (c) return c;
  return d;
};

// Pretty labels by proc layer code. Matches the legacy sub-tab text.
const LAYER_LABEL: Record<string, string> = {
  I: 'Single',
  '1': 'Layer 1 - mature',
  '2': 'Layer 2 - pole',
  '3': 'Layer 3 - sapling',
  '4': 'Layer 4 - regen',
};

// Synthetic "no data yet" detail used when LayerDetailPanel renders a
// layer whose layerId is null (regime has no layers; user is seeing the
// synthetic Single tab). All density fields blank + empty species lists
// — the densities still need to render so the user has the Edit button
// to type values into. The proc's SAVE-as-ADD branch fires on the
// first Save and assigns a real id.
const EMPTY_LAYER_DETAIL = (layerCode: string): StandardRegimeLayerDetail => ({
  layerCode,
  layerId: null,
  treeSizeUnitCode: null,
  targetStocking: null,
  minHorizontalDistance: null,
  minPrefStockingStandard: null,
  minStockingStandard: null,
  residualBasalArea: null,
  minPostSpacing: null,
  maxPostSpacing: null,
  maxConifer: null,
  heightRelativeToComp: null,
  revisionCount: null,
  preferredSpecies: [],
  acceptableSpecies: [],
});

const LayerDetailPanel: FC<{
  fspId: string;
  regimeId: string;
  amendmentNumber: string;
  layer: StandardRegimeLayer;
  readOnly?: boolean;
  /** Called after a brand-new layer is created (initial Save on the
   *  synthetic empty Single tab) so the parent can refetch the regime
   *  detail and rebuild its tab strip with the real layer flags. */
  onLayerCreated?: () => void;
}> = ({
  fspId,
  regimeId,
  amendmentNumber,
  layer,
  readOnly = false,
  onLayerCreated,
}) => {
  const [detail, setDetail] = useState<StandardRegimeLayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LayerFormState | null>(null);
  const [errors, setErrors] = useState<LayerErrors>({});
  const [saving, setSaving] = useState(false);
  // Species code list — bounded lookup, fetched once per layer panel
  // mount and shared by both Preferred + Acceptable composers.
  const [speciesCodes, setSpeciesCodes] = useState<CodeOption[]>([]);
  const [speciesCodesLoading, setSpeciesCodesLoading] = useState(false);
  const { display } = useNotification();

  useEffect(() => {
    let cancelled = false;
    setSpeciesCodesLoading(true);
    getSilvTreeSpeciesCodes()
      .then((rows) => {
        if (!cancelled) setSpeciesCodes(rows);
      })
      .catch(() => {
        // Non-fatal — the composer dropdowns just stay empty and the
        // Add button is disabled.
        if (!cancelled) setSpeciesCodes([]);
      })
      .finally(() => {
        if (!cancelled) setSpeciesCodesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSpeciesAdd = async (
    speciesCode: string,
    minHeight: string,
    preferred: boolean,
  ) => {
    if (!layer.layerCode || !layer.layerId) return;
    const updated = await addLayerSpecies(
      fspId,
      regimeId,
      layer.layerCode,
      layer.layerId,
      { speciesCode, minHeight: minHeight || null, preferred },
    );
    setDetail(updated);
    display({
      kind: 'success',
      title: `${preferred ? 'Preferred' : 'Acceptable'} species added.`,
      timeout: 5000,
    });
  };

  const handleSpeciesDelete = async (
    speciesCode: string,
    preferred: boolean,
    revisionCount: string,
  ) => {
    if (!layer.layerCode || !layer.layerId) return;
    const updated = await deleteLayerSpecies(
      fspId,
      regimeId,
      layer.layerCode,
      layer.layerId,
      speciesCode,
      preferred,
      revisionCount,
    );
    setDetail(updated);
    display({
      kind: 'success',
      title: `${preferred ? 'Preferred' : 'Acceptable'} species removed.`,
      timeout: 5000,
    });
  };

  useEffect(() => {
    if (!layer.layerCode) return;
    // No layerId = synthetic empty layer (e.g. Single tab on a regime
    // with no layers yet). Skip the GET and render placeholders; the
    // user can click Edit to type values and Save, which will route
    // through the proc's ADD branch and create the real layer.
    if (!layer.layerId) {
      setDetail(EMPTY_LAYER_DETAIL(layer.layerCode));
      setEditing(false);
      setForm(null);
      setErrors({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setEditing(false);
    setForm(null);
    setErrors({});
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

  // Resync form to the detail when we're not actively editing
  // (post-save refresh, layer switch). Preserve in-flight edits.
  useEffect(() => {
    if (!editing && detail) {
      setForm(createLayerForm(detail));
      setErrors({});
    }
  }, [detail, editing]);

  const setField = <K extends keyof LayerFormState>(key: K, value: LayerFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleEdit = () => {
    if (!detail) return;
    setForm(createLayerForm(detail));
    setErrors({});
    setEditing(true);
  };

  const handleCancel = () => {
    if (detail) setForm(createLayerForm(detail));
    setErrors({});
    setEditing(false);
  };

  const handleSave = async () => {
    if (!form || !layer.layerCode) return;
    const found = validateLayer(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const isCreate = !layer.layerId;
    setSaving(true);
    try {
      const updated = await updateStandardRegimeLayer(
        fspId,
        regimeId,
        layer.layerCode,
        layer.layerId,
        toLayerPayload(form),
        amendmentNumber || undefined,
      );
      setDetail(updated);
      setEditing(false);
      display({
        kind: 'success',
        title: isCreate ? 'Layer created.' : 'Layer updated.',
        timeout: 7000,
      });
      // On the first save of a synthetic Single tab, ask the parent to
      // refetch the regime so its layer flags reflect the new row and
      // the tab strip rebuilds against real ids (lets the Species
      // editors enable Add).
      if (isCreate) onLayerCreated?.();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save layer',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSaving(false);
    }
  };

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
    { label: 'Min horiz', well: detail.minHorizontalDistance, basal: '', post: '' },
    { label: 'Min pref', well: detail.minPrefStockingStandard, basal: '', post: '' },
    {
      label: 'Min',
      well: detail.minStockingStandard,
      basal: detail.residualBasalArea,
      post: detail.minPostSpacing,
    },
    { label: 'Max', well: '', basal: '', post: detail.maxPostSpacing },
  ];

  // Pretty unit label used inside read-mode and edit-mode helper text.

  return (
    <div className="fsp-info__tab-panel">
      {!editing && !readOnly && (
        <div className="fsp-info__tab-actions">
          <Button kind="tertiary" size="sm" renderIcon={Edit} onClick={handleEdit}>
            Edit
          </Button>
        </div>
      )}

      {editing && form ? (
        <>
          <div className="fsp-info__edit-grid">
            <Select
              id={`edit-layer-treeUnit-${layer.layerCode}`}
              labelText="Tree size unit"
              value={form.treeSizeUnitCode}
              disabled={saving}
              onChange={(e) => setField('treeSizeUnitCode', e.target.value)}
            >
              <SelectItem value="CM" text="Centimetres" />
              <SelectItem value="PCT" text="Percent" />
            </Select>
            <NumberInput
              id={`edit-layer-targetStocking-${layer.layerCode}`}
              label="Target stocking"
              min={0}
              allowEmpty
              hideSteppers
              value={form.targetStocking === '' ? '' : Number(form.targetStocking)}
              invalid={!!errors.targetStocking}
              invalidText={errors.targetStocking}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('targetStocking', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-minHoriz-${layer.layerCode}`}
              label="Min horizontal distance"
              min={0}
              allowEmpty
              hideSteppers
              value={form.minHorizontalDistance === '' ? '' : Number(form.minHorizontalDistance)}
              invalid={!!errors.minHorizontalDistance}
              invalidText={errors.minHorizontalDistance}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('minHorizontalDistance', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-minPref-${layer.layerCode}`}
              label="Min preferred stocking"
              min={0}
              allowEmpty
              hideSteppers
              value={form.minPrefStockingStandard === '' ? '' : Number(form.minPrefStockingStandard)}
              invalid={!!errors.minPrefStockingStandard}
              invalidText={errors.minPrefStockingStandard}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('minPrefStockingStandard', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-minStocking-${layer.layerCode}`}
              label="Min stocking"
              min={0}
              allowEmpty
              hideSteppers
              value={form.minStockingStandard === '' ? '' : Number(form.minStockingStandard)}
              invalid={!!errors.minStockingStandard}
              invalidText={errors.minStockingStandard}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('minStockingStandard', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-basalArea-${layer.layerCode}`}
              label="Residual basal area"
              min={0}
              allowEmpty
              hideSteppers
              value={form.residualBasalArea === '' ? '' : Number(form.residualBasalArea)}
              invalid={!!errors.residualBasalArea}
              invalidText={errors.residualBasalArea}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('residualBasalArea', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-minPost-${layer.layerCode}`}
              label="Min post spacing"
              min={0}
              allowEmpty
              hideSteppers
              value={form.minPostSpacing === '' ? '' : Number(form.minPostSpacing)}
              invalid={!!errors.minPostSpacing}
              invalidText={errors.minPostSpacing}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('minPostSpacing', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-maxPost-${layer.layerCode}`}
              label="Max post spacing"
              min={0}
              allowEmpty
              hideSteppers
              value={form.maxPostSpacing === '' ? '' : Number(form.maxPostSpacing)}
              invalid={!!errors.maxPostSpacing}
              invalidText={errors.maxPostSpacing}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('maxPostSpacing', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-maxConifer-${layer.layerCode}`}
              label="Max coniferous"
              min={0}
              allowEmpty
              hideSteppers
              value={form.maxConifer === '' ? '' : Number(form.maxConifer)}
              invalid={!!errors.maxConifer}
              invalidText={errors.maxConifer}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('maxConifer', value === '' ? '' : String(value))
              }
            />
            <NumberInput
              id={`edit-layer-heightRel-${layer.layerCode}`}
              label="Height relative to comp"
              min={0}
              allowEmpty
              hideSteppers
              value={form.heightRelativeToComp === '' ? '' : Number(form.heightRelativeToComp)}
              invalid={!!errors.heightRelativeToComp}
              invalidText={errors.heightRelativeToComp}
              disabled={saving}
              onChange={(_e, { value }) =>
                setField('heightRelativeToComp', value === '' ? '' : String(value))
              }
            />
          </div>

          <div className="fsp-info__form-actions">
            <Button kind="secondary" size="sm" disabled={saving} onClick={handleCancel}>
              Cancel
            </Button>
            <Button kind="primary" size="sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : (
        <>
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
                  { key: 'well', header: 'Well spaced trees / ha' },
                  { key: 'basal', header: 'Residual basal area' },
                  { key: 'post', header: 'Post spacing density' },
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
              <dt>Max coniferous</dt>
              <dd>{dash(detail.maxConifer)}</dd>
            </div>
            <div className="fsp-info__field">
              <dt>Height relative to comp</dt>
              <dd>{dash(detail.heightRelativeToComp)}</dd>
            </div>
          </dl>
        </>
      )}

      <SpeciesEditor
        title="Preferred species"
        rows={detail.preferredSpecies}
        idPrefix={`pref-${layer.layerCode}`}
        preferred
        readOnly={readOnly}
        layerExists={!!layer.layerId}
        speciesCodes={speciesCodes}
        speciesCodesLoading={speciesCodesLoading}
        onAdd={handleSpeciesAdd}
        onDelete={handleSpeciesDelete}
      />

      <SpeciesEditor
        title="Acceptable species"
        rows={detail.acceptableSpecies}
        idPrefix={`acc-${layer.layerCode}`}
        preferred={false}
        readOnly={readOnly}
        layerExists={!!layer.layerId}
        speciesCodes={speciesCodes}
        speciesCodesLoading={speciesCodesLoading}
        onAdd={handleSpeciesAdd}
        onDelete={handleSpeciesDelete}
      />
    </div>
  );
};

/**
 * Editable species list for one layer side (preferred OR acceptable).
 * Existing rows render with a trash-icon delete; a composer row at
 * the bottom (species dropdown + Min Height + Add) lets the user
 * append a new species. Available codes are filtered to exclude any
 * already in the list — prevents the FK-violation that the proc
 * would otherwise raise on duplicate (layer_id, species_code).
 */
const SpeciesEditor: FC<{
  title: string;
  rows: StandardRegimeSpecies[];
  idPrefix: string;
  preferred: boolean;
  readOnly?: boolean;
  /** False when the parent layer has no id yet (synthetic empty Single
   *  on a regime with no layers). Add stays disabled until the user
   *  saves the layer densities first. */
  layerExists?: boolean;
  speciesCodes: CodeOption[];
  speciesCodesLoading: boolean;
  onAdd: (
    speciesCode: string,
    minHeight: string,
    preferred: boolean,
  ) => Promise<void>;
  onDelete: (
    speciesCode: string,
    preferred: boolean,
    revisionCount: string,
  ) => Promise<void>;
}> = ({
  title,
  rows,
  idPrefix,
  preferred,
  readOnly = false,
  layerExists = true,
  speciesCodes,
  speciesCodesLoading,
  onAdd,
  onDelete,
}) => {
  const { display } = useNotification();
  const [composerCode, setComposerCode] = useState('');
  const [composerMinHeight, setComposerMinHeight] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);

  // Exclude codes already in this list — prevents duplicate-key violations.
  const usedCodes = new Set(rows.map((r) => r.code).filter(Boolean) as string[]);
  const availableCodes = speciesCodes.filter(
    (c) => c.code != null && !usedCodes.has(c.code),
  );

  const resetComposer = () => {
    setComposerCode('');
    setComposerMinHeight('');
  };

  const handleDelete = async (row: StandardRegimeSpecies) => {
    if (!row.code || !row.revisionCount) return;
    setDeletingCode(row.code);
    try {
      await onDelete(row.code, preferred, row.revisionCount);
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to remove species',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setDeletingCode(null);
    }
  };

  const [modalOpen, setModalOpen] = useState(false);

  const closeModal = () => {
    if (adding) return; // don't allow closing mid-save
    setModalOpen(false);
    resetComposer();
  };

  const submitModal = async () => {
    if (!composerCode || !composerMinHeight.trim()) return;
    setAdding(true);
    try {
      await onAdd(composerCode, composerMinHeight.trim(), preferred);
      resetComposer();
      setModalOpen(false);
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to add species',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="fsp-info__species-section">
      <header className="fsp-info__species-section-header">
        <h3 className="fsp-info__section-title">{title}</h3>
        {!readOnly && (
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Add}
            disabled={
              !layerExists ||
              speciesCodesLoading ||
              availableCodes.length === 0
            }
            onClick={() => {
              resetComposer();
              setModalOpen(true);
            }}
          >
            {`Add ${title}`}
          </Button>
        )}
      </header>

      {!layerExists ? (
        <p>Enter layer data and save before adding species.</p>
      ) : rows.length === 0 ? (
        <p>No {title.toLowerCase()}.</p>
      ) : (
        <div className="bordered-table">
          <TableContainer>
            <Table size="md">
              <TableHead>
                <TableRow>
                  <TableHeader>Species</TableHeader>
                  <TableHeader
                    className="fsp-info__cell--numeric"
                    style={{ width: '8rem' }}
                  >
                    Min height
                  </TableHeader>
                  {!readOnly && (
                    <TableHeader style={{ width: '4rem' }} aria-label="Actions" />
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row, i) => {
                  const rowId = `${idPrefix}-${row.code ?? i}`;
                  const busy = deletingCode === row.code;
                  return (
                    <TableRow key={rowId}>
                      <TableCell>
                        {dash(row.description ?? row.code)}
                      </TableCell>
                      <TableCell className="fsp-info__cell--numeric">
                        {dash(row.minHeight)}
                      </TableCell>
                      {!readOnly && (
                        <TableCell>
                          <Button
                            kind="ghost"
                            size="sm"
                            renderIcon={TrashCan}
                            iconDescription={busy ? 'Removing…' : 'Remove'}
                            hasIconOnly
                            disabled={busy || !row.code || !row.revisionCount}
                            onClick={() => void handleDelete(row)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}

      <Modal
        open={modalOpen}
        modalHeading={`Add ${title}`}
        passiveModal
        size="sm"
        className="fsp-species-modal"
        onRequestClose={closeModal}
        preventCloseOnClickOutside
      >
        <Stack gap={5} className="fsp-species-modal__form">
          <Select
            id={`${idPrefix}-modal-species`}
            labelText="Species *"
            value={composerCode}
            disabled={adding || speciesCodesLoading || availableCodes.length === 0}
            onChange={(e) => setComposerCode(e.target.value)}
          >
            <SelectItem
              value=""
              text={
                speciesCodesLoading
                  ? 'Loading…'
                  : availableCodes.length === 0
                    ? 'No species left to add'
                    : '— Select species —'
              }
            />
            {availableCodes.map((c) => (
              <SelectItem
                key={c.code ?? ''}
                value={c.code ?? ''}
                text={formatSpeciesLabel(c.code, c.description)}
              />
            ))}
          </Select>
          <NumberInput
            id={`${idPrefix}-modal-minHeight`}
            label="Min height *"
            min={0}
            allowEmpty
            hideSteppers
            value={composerMinHeight === '' ? '' : Number(composerMinHeight)}
            disabled={adding}
            onChange={(_e, { value }) =>
              setComposerMinHeight(value === '' ? '' : String(value))
            }
          />
        </Stack>
        <div className="fsp-species-modal__actions">
          <Button kind="secondary" disabled={adding} onClick={closeModal}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={adding || !composerCode || !composerMinHeight.trim()}
            renderIcon={adding ? SavingIcon : undefined}
            onClick={() => void submitModal()}
          >
            {adding ? 'Adding…' : 'Save'}
          </Button>
        </div>
      </Modal>
    </section>
  );
};

/**
 * Renders the layer sub-tab strip + the active layer's detail panel.
 * Only layers the regime has data for are rendered (`layers` filtered
 * server-side from the Y flags in FSP_550_STDS_PROPOSAL).
 */
const StandardRegimeLayersPanel: FC<Props> = ({
  fspId,
  regimeId,
  amendmentNumber,
  layers,
  readOnly = false,
  onDetailRefreshed,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const { display } = useNotification();

  // Reset to first tab when the regime changes (the parent already
  // remounts on regime change via its key, but defensive in case it
  // ever stops doing that).
  useEffect(() => {
    setActiveIndex(0);
  }, [regimeId]);

  // Real layers as the backend reported them. Only filter out entries
  // without a layerCode; a missing layerId still gets a tab so the
  // per-layer fetch can surface whatever data is there.
  const realTabs = useMemo(
    () =>
      (layers ?? []).filter((l) => l.layerCode !== null) as Array<
        StandardRegimeLayer & { layerCode: string; layerId: string | null }
      >,
    [layers],
  );

  // When the regime has no layers at all, render a synthetic Single
  // tab so the user can still see the layer widgets + Edit button.
  // Saving the form fires the proc's ADD branch (P_REVISION_COUNT
  // null) and onLayerCreated bubbles a re-fetch so the synthetic tab
  // becomes a real one.
  const tabs = useMemo(
    () =>
      realTabs.length > 0
        ? realTabs
        : ([{ layerCode: 'I', layerId: null }] as Array<
            StandardRegimeLayer & { layerCode: string; layerId: string | null }
          >),
    [realTabs],
  );

  // Single-layer regimes have exactly one tab whose code is 'I'.
  // Anything else is "multi" — including 1-of-4 with only layer 4
  // present, which is still treated as the uneven-aged shape.
  const isSingleLayer =
    tabs.length === 1 && tabs[0].layerCode === 'I';
  // No real layers exist → there's nothing to convert FROM, so hide
  // the Convert button until the user saves the synthetic Single.
  const canConvert = realTabs.length > 0;

  // Refetch the regime detail and bubble it up. Used as the
  // onLayerCreated callback so the synthetic Single tab is replaced
  // by a real one (with a layerId) after the first save — which in
  // turn flips layerExists=true on the Species editors.
  const refreshRegime = useCallback(async () => {
    try {
      const updated = await getStandardRegimeDetail(
        fspId,
        regimeId,
        amendmentNumber || undefined,
      );
      onDetailRefreshed?.(updated);
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to refresh regime after layer save',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 7000,
      });
    }
  }, [fspId, regimeId, amendmentNumber, onDetailRefreshed, display]);
  const convertLabel = isSingleLayer
    ? 'Convert to multi-layer'
    : 'Convert to single layer';
  const convertConfirm = isSingleLayer
    ? 'Convert this regime to multi-layer? The current layer becomes Layer 4, and empty layers 1, 2, 3 are added.'
    : 'Convert this regime to single layer? Layers 1, 2, and 3 (and their species) will be deleted; layer 4 becomes the single layer.';

  // Actual convert call — invoked by the confirmation modal. Errors
  // surface as a toast through ConfirmationModal's catch path (it
  // shows `errorTitle` + the thrown message), so we just rethrow here.
  const performConvert = async () => {
    const updated = await convertStandardRegimeLayers(
      fspId,
      regimeId,
      amendmentNumber || undefined,
    );
    onDetailRefreshed?.(updated);
    display({
      kind: 'success',
      title: isSingleLayer
        ? 'Converted to multi-layer.'
        : 'Converted to single layer.',
      timeout: 6000,
    });
  };

  return (
    <div className="fsp-info__inner-tabs fsp-info__inner-tabs--gray">
      {!readOnly && canConvert && (
        <div className="fsp-info__tab-actions">
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => setConvertConfirmOpen(true)}
          >
            {convertLabel}
          </Button>
        </div>
      )}
      <Tabs selectedIndex={activeIndex} onChange={({ selectedIndex }) => setActiveIndex(selectedIndex)}>
        <TabList aria-label="Standards regime layers" contained>
          {tabs.map((l) => (
            <Tab key={l.layerCode}>{LAYER_LABEL[l.layerCode] ?? `Layer ${l.layerCode}`}</Tab>
          ))}
        </TabList>
        <TabPanels>
          {tabs.map((l) => (
            <TabPanel key={l.layerCode}>
              <LayerDetailPanel
                fspId={fspId}
                regimeId={regimeId}
                amendmentNumber={amendmentNumber}
                layer={l}
                readOnly={readOnly}
                onLayerCreated={refreshRegime}
              />
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>
      <ConfirmationModal
        open={convertConfirmOpen}
        onClose={() => setConvertConfirmOpen(false)}
        heading={convertLabel}
        confirmLabel={isSingleLayer ? 'Convert' : 'Convert'}
        danger={!isSingleLayer}
        errorTitle="Failed to convert layers"
        onConfirm={performConvert}
      >
        <p>{convertConfirm}</p>
      </ConfirmationModal>
    </div>
  );
};

export default StandardRegimeLayersPanel;
