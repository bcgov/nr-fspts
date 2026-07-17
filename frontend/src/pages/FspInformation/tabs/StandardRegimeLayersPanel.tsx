import {
  Button,
  Loading,
  NumberInput,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import {Add, Copy, Launch, TrashCan} from '@carbon/icons-react';
import {type FC, forwardRef, type ReactNode, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';

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

import { EDIT_PANE, useEditLock, useEditRegistration } from '../editLock';

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

// Density matrix: five rows × three value columns, matching the legacy
// layer table. Each cell names the layer field it edits (or null for a
// cell that column doesn't use — rendered as a dash). Only the named
// cells become editable inputs in edit mode.
type DensityField = keyof LayerFormState & keyof StandardRegimeLayerDetail;
const DENSITY_ROWS: {
  label: string;
  well: DensityField | null;
  basal: DensityField | null;
  post: DensityField | null;
}[] = [
  { label: 'Target', well: 'targetStocking', basal: null, post: null },
  { label: 'Min horiz', well: 'minHorizontalDistance', basal: null, post: null },
  { label: 'Min pref', well: 'minPrefStockingStandard', basal: null, post: null },
  { label: 'Min', well: 'minStockingStandard', basal: 'residualBasalArea', post: 'minPostSpacing' },
  { label: 'Max', well: null, basal: null, post: 'maxPostSpacing' },
];

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

/** Imperative surface a multi-layer regime uses to drive one regime-level
 *  Save all / Cancel all across every mounted layer panel. */
interface LayerPanelHandle {
  isEditing: () => boolean;
  /** Validate this layer's form; sets inline errors and returns validity. */
  validate: () => boolean;
  /** Persist this layer (assumes validate() already passed). Returns success. */
  persist: () => Promise<boolean>;
  /** Leave edit mode without reverting (used after a successful save-all). */
  finishEdit: () => void;
  /** Revert this layer's form and leave edit mode. */
  cancel: () => void;
}

interface LayerDetailPanelProps {
  fspId: string;
  regimeId: string;
  amendmentNumber: string;
  layer: StandardRegimeLayer;
  readOnly?: boolean;
  /** Called after a brand-new layer is created (initial Save on the
   *  synthetic empty Single tab) so the parent can refetch the regime
   *  detail and rebuild its tab strip with the real layer flags. */
  onLayerCreated?: () => void;
  /** Title for the white card header bar on a single-layer regime
   *  ("Single layer"). Ignored when headerContent is supplied. */
  cardTitle?: string;
  /** Custom content for the white card header bar — the multi-layer sub-tab
   *  strip. When set it replaces cardTitle so the layer tabs live INSIDE the
   *  primary density table (white), not as a separate strip above it. */
  headerContent?: ReactNode;
  /** Opens the convert-layers confirmation (rendered as the convert link
   *  in the card header). Omitted when convert isn't available (e.g. an
   *  unsaved synthetic layer, or a read-only regime). */
  onConvert?: () => void;
  convertLabel?: string;
  /** Monotonic counter bumped by the parent when the user clicks
   *  "Edit layers". Every mounted layer panel watches it and enters edit
   *  together, so a multi-layer regime edits all tabs at once. */
  editSignal?: number;
  /** Handler for this panel's "Edit layers" button. In a multi-layer regime
   *  it asks the parent to bump editSignal (edit-all); when absent (single
   *  layer) the button falls back to editing just this panel. */
  onEditRequest?: () => void;
  /** Reports this panel's edit state up so the parent can drive the single
   *  page-wide edit-lock registration for the whole Layers pane. */
  onEditingChange?: (layerCode: string | null, editing: boolean) => void;
  /** When set (multi-layer), the in-card Save/Cancel bar drives a single
   *  regime-level Save all / Cancel all instead of saving just this layer. */
  onSaveAll?: () => void;
  onCancelAll?: () => void;
  /** True while a regime-level save-all is in flight — disables the bar. */
  savingAll?: boolean;
}

const LayerDetailPanel = forwardRef<LayerPanelHandle, LayerDetailPanelProps>(({
  fspId,
  regimeId,
  amendmentNumber,
  layer,
  readOnly = false,
  onLayerCreated,
  cardTitle,
  headerContent,
  onConvert,
  convertLabel,
  editSignal,
  onEditRequest,
  onEditingChange,
  onSaveAll,
  onCancelAll,
  savingAll = false,
}, ref) => {
  const [detail, setDetail] = useState<StandardRegimeLayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  // The page-wide edit lock is registered once by the PARENT for the whole
  // Layers pane (based on "any layer editing") — not per panel — so that
  // saving one tab doesn't clear the lock while other tabs are still being
  // edited. Here we only READ the lock (anyEditing) and REPORT this panel's
  // edit state up via onEditingChange (below).
  const { anyEditing } = useEditLock();
  // Focus the first density input when entering edit mode.
  const firstFieldRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (editing) firstFieldRef.current?.focus();
  }, [editing]);

  // Report edit state up so the parent can drive one page-wide edit-lock
  // registration for the whole Layers pane (see the parent's aggregation).
  useEffect(() => {
    onEditingChange?.(layer.layerCode, editing);
  }, [editing, layer.layerCode, onEditingChange]);

  // Enter edit whenever the parent bumps editSignal ("Edit layers" clicked)
  // — this is what makes a multi-layer regime edit ALL tabs at once. Skipped
  // for read-only regimes, until the layer detail has loaded, and (crucially)
  // for a panel that's ALREADY editing — so re-broadcasting after one tab was
  // saved re-enters the view-mode tabs without wiping in-progress edits.
  const lastEditSignal = useRef(editSignal);
  useEffect(() => {
    if (editSignal === lastEditSignal.current) return;
    lastEditSignal.current = editSignal;
    if (readOnly || !detail || editing) return;
    setForm(createLayerForm(detail));
    setErrors({});
    setEditing(true);
  }, [editSignal, readOnly, detail, editing]);

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

  // Validate this layer's form; sets inline errors and returns validity.
  const validate = (): boolean => {
    if (!form) return true;
    const found = validateLayer(form);
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  // Has the form diverged from the loaded detail? Used to skip a no-op save
  // of an untouched layer during Save all.
  const isDirty = (): boolean => {
    if (!form || !detail) return true;
    const base = createLayerForm(detail);
    return (Object.keys(form) as (keyof LayerFormState)[]).some(
      (k) => form[k] !== base[k],
    );
  };

  // Persist this layer (caller validates first). No success toast — the
  // caller decides (single-layer save vs one aggregate save-all toast).
  const persist = async (): Promise<boolean> => {
    if (!form || !layer.layerCode) return true;
    const isCreate = !layer.layerId;
    // Skip a no-op re-save of an existing, unchanged layer (Save all re-saves
    // every editing tab); always run for a create so the layer row is made.
    if (!isCreate && !isDirty()) return true;
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
      // On the first save of a synthetic Single tab, ask the parent to
      // refetch the regime so its layer flags reflect the new row and the
      // tab strip rebuilds against real ids (lets the Species editors
      // enable Add).
      if (isCreate) onLayerCreated?.();
      return true;
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to save layer',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Single-layer regimes save just this one layer directly.
  const handleSave = async () => {
    if (!validate()) return;
    const isCreate = !layer.layerId;
    if (!(await persist())) return;
    setEditing(false);
    display({
      kind: 'success',
      title: isCreate ? 'Layer created.' : 'Layer updated.',
      timeout: 7000,
    });
  };

  // Imperative surface for the parent's regime-level Save all / Cancel all
  // (multi-layer). No dep array → recreated each render so the closures
  // always see the current form/detail/editing.
  useImperativeHandle(ref, () => ({
    isEditing: () => editing,
    validate,
    persist,
    finishEdit: () => setEditing(false),
    cancel: handleCancel,
  }));

  if (loading && !detail) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading layer…" withOverlay={false} />
      </div>
    );
  }
  if (!detail) return <p>No layer data available.</p>;

  // Renders one density-matrix cell: a gray editable input while
  // editing (for the cells this column actually uses), a dash otherwise.
  const densityCell = (field: DensityField | null, first = false) => {
    if (!field) return '—';
    if (editing && form) {
      return (
        <TextInput
          id={`edit-layer-${field}-${layer.layerCode}`}
          ref={first ? firstFieldRef : undefined}
          labelText={field}
          hideLabel
          size="sm"
          inputMode="decimal"
          value={form[field]}
          invalid={!!errors[field]}
          invalidText={errors[field]}
          disabled={saving}
          onChange={(e) => setField(field, e.target.value)}
        />
      );
    }
    return dash(detail[field]);
  };

  return (
    <div className="fsp-info__tab-panel">
      {!editing && !readOnly && (
        <div className="fsp-info__tab-actions">
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Launch}
            disabled={anyEditing}
            onClick={onEditRequest ?? handleEdit}
          >
            Edit layers
          </Button>
        </div>
      )}

      {/* Density matrix — same table shape in both modes; the editable
          cells become gray inputs while editing. Every layer card gets a
          white header bar in BOTH view and edit modes: single-layer shows
          the "Single layer" title, multi-layer hosts the white layer
          sub-tabs (headerContent) inside this same primary table so both
          shapes read consistently. The convert link sits on the right. */}
      <section className="fsp-info__layer-card">
        <div
          className={
            editing
              ? 'bordered-table fsp-info__density-table fsp-info__density-table--editing'
              : 'bordered-table fsp-info__density-table'
          }
        >
          {(headerContent || cardTitle) && (
            <div
              className={
                headerContent
                  ? 'fsp-info__layer-card-header fsp-info__layer-card-header--tabs'
                  : 'fsp-info__layer-card-header'
              }
            >
              {headerContent ?? (
                <h3 className="fsp-info__layer-card-title">{cardTitle}</h3>
              )}
              {onConvert && (
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={Copy}
                  disabled={editing ? saving : anyEditing}
                  onClick={onConvert}
                >
                  {convertLabel ?? 'Convert to multi-layer'}
                </Button>
              )}
            </div>
          )}
          <Table size="md">
            <TableHead>
              <TableRow>
                <TableHeader aria-label="Metric" />
                <TableHeader>Well spaced trees / ha</TableHeader>
                <TableHeader>Residual basal area</TableHeader>
                <TableHeader>Post spacing density</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {DENSITY_ROWS.map((r, i) => (
                <TableRow key={r.label}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell>{densityCell(r.well, i === 0)}</TableCell>
                  <TableCell>{densityCell(r.basal)}</TableCell>
                  <TableCell>{densityCell(r.post)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Max coniferous / Height relative to comp — white inputs while
          editing, bold-label fields in read-only. */}
      {editing && form ? (
        <div className="fsp-info__edit-grid fsp-info__layer-extra">
          <NumberInput
            id={`edit-layer-maxConifer-${layer.layerCode}`}
            label="Max coniferous (st/ha)"
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
            label="Height relative to comp (cm/%)"
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
      ) : (
        <dl className="fsp-info__field-list fsp-info__field-list--overview">
          <div className="fsp-info__field">
            <dt>Max coniferous (st/ha)</dt>
            <dd>{dash(detail.maxConifer)}</dd>
          </div>
          <div className="fsp-info__field">
            <dt>Height relative to comp (cm/%)</dt>
            <dd>{dash(detail.heightRelativeToComp)}</dd>
          </div>
        </dl>
      )}

      {/* Save/Cancel bar. Multi-layer (onSaveAll set) drives a single
          regime-level Save all / Cancel all; single-layer saves just itself.
          Only the active tab's bar is visible, so the user sees one bar. */}
      {editing && (
        <div className="fsp-info__form-actions">
          <Button
            kind="secondary"
            size="sm"
            disabled={saving || savingAll}
            onClick={onCancelAll ?? handleCancel}
          >
            Cancel
          </Button>
          <Button
            kind="primary"
            size="sm"
            disabled={saving || savingAll}
            onClick={onSaveAll ?? handleSave}
          >
            {saving || savingAll ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}

      <hr className="fsp-info__divider" />

      <SpeciesEditor
        title="Preferred species"
        rows={detail.preferredSpecies}
        idPrefix={`pref-${layer.layerCode}`}
        preferred
        readOnly={readOnly}
        disabled={anyEditing}
        layerExists={!!layer.layerId}
        speciesCodes={speciesCodes}
        speciesCodesLoading={speciesCodesLoading}
        onAdd={handleSpeciesAdd}
        onDelete={handleSpeciesDelete}
      />

      <hr className="fsp-info__divider" />

      <SpeciesEditor
        title="Acceptable species"
        rows={detail.acceptableSpecies}
        idPrefix={`acc-${layer.layerCode}`}
        preferred={false}
        readOnly={readOnly}
        disabled={anyEditing}
        layerExists={!!layer.layerId}
        speciesCodes={speciesCodes}
        speciesCodesLoading={speciesCodesLoading}
        onAdd={handleSpeciesAdd}
        onDelete={handleSpeciesDelete}
      />
    </div>
  );
});
LayerDetailPanel.displayName = 'LayerDetailPanel';

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
  /** True while the parent layer's density form is being edited — the
   *  species Add/Delete actions are suppressed so the two edit flows
   *  don't overlap (matches the screenshot's greyed-out Add buttons). */
  disabled?: boolean;
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
  disabled = false,
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
  // Deferred validation — matches the other dialogs: the Save button stays
  // enabled and clicking it with missing values reveals inline field errors
  // rather than silently doing nothing.
  const [showErrors, setShowErrors] = useState(false);

  const codeError = !composerCode;
  const minHeightError = !composerMinHeight.trim();

  const closeModal = () => {
    if (adding) return; // don't allow closing mid-save
    setModalOpen(false);
    setShowErrors(false);
    resetComposer();
  };

  const submitModal = async () => {
    if (codeError || minHeightError) {
      setShowErrors(true);
      return;
    }
    setAdding(true);
    try {
      await onAdd(composerCode, composerMinHeight.trim(), preferred);
      resetComposer();
      setShowErrors(false);
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
              disabled ||
              !layerExists ||
              speciesCodesLoading ||
              availableCodes.length === 0
            }
            onClick={() => {
              resetComposer();
              setShowErrors(false);
              setModalOpen(true);
            }}
          >
            {`Add ${title.toLowerCase()}`}
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
                            kind="danger--ghost"
                            size="sm"
                            renderIcon={TrashCan}
                            disabled={disabled || busy || !row.code || !row.revisionCount}
                            onClick={() => void handleDelete(row)}
                          >
                            {busy ? 'Removing…' : 'Delete'}
                          </Button>
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
            labelText="Species"
            value={composerCode}
            disabled={adding || speciesCodesLoading || availableCodes.length === 0}
            invalid={showErrors && codeError}
            invalidText="Select a species."
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
            label="Min height"
            min={0}
            allowEmpty
            hideSteppers
            value={composerMinHeight === '' ? '' : Number(composerMinHeight)}
            disabled={adding}
            invalid={showErrors && minHeightError}
            invalidText="Enter a minimum height."
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
            disabled={adding}
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

  // "Edit layers" broadcast: bumping this counter makes every mounted layer
  // panel enter edit together, so a multi-layer regime edits all tabs at once.
  const [editSignal, setEditSignal] = useState(0);
  const requestEditAll = useCallback(() => setEditSignal((n) => n + 1), []);

  // Aggregate each layer panel's edit state into ONE page-wide edit-lock
  // registration for the whole Layers pane. Registering per panel would let
  // saving one tab clear the lock while other tabs are still being edited.
  const [editingByLayer, setEditingByLayer] = useState<Record<string, boolean>>(
    {},
  );
  const handleLayerEditingChange = useCallback(
    (layerCode: string | null, editing: boolean) => {
      if (!layerCode) return;
      setEditingByLayer((prev) =>
        prev[layerCode] === editing ? prev : { ...prev, [layerCode]: editing },
      );
    },
    [],
  );
  const anyLayerEditing = Object.values(editingByLayer).some(Boolean);
  useEditRegistration(EDIT_PANE.stdLayers, anyLayerEditing);

  // Refs to each mounted layer panel so a multi-layer regime can drive one
  // regime-level Save all / Cancel all across every layer at once.
  const panelRefs = useRef<Record<string, LayerPanelHandle | null>>({});
  const [savingAll, setSavingAll] = useState(false);

  // Reset to first tab + clear any edit state when the regime changes (the
  // parent already remounts on regime change via its key, but defensive in
  // case it ever stops doing that). Clearing editingByLayer prevents a stale
  // per-layer flag from holding the page-wide edit lock across regimes.
  useEffect(() => {
    setActiveIndex(0);
    setEditingByLayer({});
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

  // Regime-level Save all: validate every editing layer first (switching to
  // the first tab with an error so its inline messages are visible), then
  // persist them in order, then leave edit mode on all. Aborts on the first
  // persist failure, surfacing that tab.
  const handleSaveAll = async () => {
    const editing = tabs
      .map((l, i) => ({ index: i, handle: panelRefs.current[l.layerCode] }))
      .filter(
        (e): e is { index: number; handle: LayerPanelHandle } =>
          !!e.handle && e.handle.isEditing(),
      );
    if (editing.length === 0) return;

    for (const e of editing) {
      if (!e.handle.validate()) {
        setActiveIndex(e.index);
        return;
      }
    }

    setSavingAll(true);
    try {
      for (const e of editing) {
        if (!(await e.handle.persist())) {
          setActiveIndex(e.index);
          return;
        }
      }
      editing.forEach((e) => e.handle.finishEdit());
      display({
        kind: 'success',
        title:
          editing.length > 1 ? 'All layers saved.' : 'Layer saved.',
        timeout: 6000,
      });
    } finally {
      setSavingAll(false);
    }
  };

  // Regime-level Cancel all: revert every layer's form and leave edit mode.
  const handleCancelAll = () => {
    tabs.forEach((l) => panelRefs.current[l.layerCode]?.cancel());
  };

  // Multi-layer sub-tab strip, handed to every layer panel as headerContent
  // so the tabs render INSIDE each density card's white header (part of the
  // primary table) rather than as a separate strip above it. All layer
  // panels stay mounted (inactive ones just `hidden`) so switching tabs
  // never remounts/refetches and preserves each layer's in-progress edits.
  const layerTabs = (
    <div
      className="fsp-info__layer-tabs"
      role="tablist"
      aria-label="Standards regime layers"
    >
      {tabs.map((l, i) => (
        <button
          key={l.layerCode}
          type="button"
          role="tab"
          aria-selected={i === activeIndex}
          className={
            i === activeIndex
              ? 'fsp-info__layer-tab fsp-info__layer-tab--active'
              : 'fsp-info__layer-tab'
          }
          onClick={() => setActiveIndex(i)}
        >
          {LAYER_LABEL[l.layerCode] ?? `Layer ${l.layerCode}`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="fsp-info__inner-tabs fsp-info__inner-tabs--detail">
      {isSingleLayer ? (
        // Single-layer regime: no sub-tab strip — render the one layer
        // directly. The convert action moves into the edit card header.
        <LayerDetailPanel
          fspId={fspId}
          regimeId={regimeId}
          amendmentNumber={amendmentNumber}
          layer={tabs[0]}
          readOnly={readOnly}
          onLayerCreated={refreshRegime}
          cardTitle="Single layer"
          onConvert={
            !readOnly && canConvert
              ? () => setConvertConfirmOpen(true)
              : undefined
          }
          convertLabel={convertLabel}
          onEditingChange={handleLayerEditingChange}
        />
      ) : (
        // Multi-layer: keep EVERY layer panel mounted and hide the inactive
        // ones. Switching tabs then just toggles visibility — no remount, no
        // refetch, and any layer mid-edit keeps its edit state. The shared
        // tab strip lives in each card's header (only the visible one shows).
        tabs.map((l, i) => (
          <div key={l.layerCode} hidden={i !== activeIndex}>
            <LayerDetailPanel
              ref={(h) => {
                panelRefs.current[l.layerCode] = h;
              }}
              fspId={fspId}
              regimeId={regimeId}
              amendmentNumber={amendmentNumber}
              layer={l}
              readOnly={readOnly}
              onLayerCreated={refreshRegime}
              headerContent={layerTabs}
              onConvert={
                !readOnly && canConvert
                  ? () => setConvertConfirmOpen(true)
                  : undefined
              }
              convertLabel={convertLabel}
              editSignal={editSignal}
              onEditRequest={requestEditAll}
              onEditingChange={handleLayerEditingChange}
              onSaveAll={() => void handleSaveAll()}
              onCancelAll={handleCancelAll}
              savingAll={savingAll}
            />
          </div>
        ))
      )}
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
