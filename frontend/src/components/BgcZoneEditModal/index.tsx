import { Button, Loading, TextInput } from '@carbon/react';
import { Modal } from '@/components/Modal';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import type {
  StandardRegimeBgcZone,
  StandardRegimeBgcZoneUpsert,
} from '@/services/fspSearch';

interface BgcZoneEditModalProps {
  open: boolean;
  /**
   * Null → Add mode (empty form, submitted as an insert).
   * Non-null → Edit mode (form is pre-filled; submit updates this row
   * by stdsRegimeSiteSeriesId + revisionCount).
   */
  value: StandardRegimeBgcZone | null;
  onClose: () => void;
  /**
   * Submitted payload. Caller wires it to addStandardRegimeBgcZone or
   * updateStandardRegimeBgcZone based on whether {@code value} was set.
   * Thrown errors surface as an error toast inside the modal.
   */
  onSubmit: (payload: StandardRegimeBgcZoneUpsert) => Promise<void>;
}

/**
 * 7-field Add/Edit dialog for a STANDARDS_REGIME_SITE_SERIES row.
 * Mirrors the SIL becFieldsContainer the legacy fsp550StdsProposal.jsp
 * used — all fields are plain text inputs since the BEC reference data
 * (zone/subzone/variant/site series) lives in BCGW and isn't exposed
 * through the fsp code-lists package.
 *
 * Field max-lengths come from STANDARDS_REGIME_SITE_SERIES column defs:
 *   zone 4 / subzone 3 / variant 1 / phase 1 /
 *   site series 4 / site series phase (BEC_SITE_TYPE) 3 / seral 4.
 */
const BgcZoneEditModal: FC<BgcZoneEditModalProps> = ({
  open,
  value,
  onClose,
  onSubmit,
}) => {
  const { display } = useNotification();
  const editing = value != null;

  const [zone, setZone] = useState('');
  const [subzone, setSubzone] = useState('');
  const [variant, setVariant] = useState('');
  const [phase, setPhase] = useState('');
  const [siteSeries, setSiteSeries] = useState('');
  const [sitePhase, setSitePhase] = useState('');
  const [seral, setSeral] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset/prefill on every open so re-opening the dialog never shows
  // stale field state from a previous edit target.
  useEffect(() => {
    if (!open) return;
    setZone(value?.bgcZoneCode ?? '');
    setSubzone(value?.bgcSubzoneCode ?? '');
    setVariant(value?.bgcVariant ?? '');
    setPhase(value?.bgcPhase ?? '');
    setSiteSeries(value?.becSiteSeriesCd ?? '');
    setSitePhase(value?.becSiteSeriesPhaseCd ?? '');
    setSeral(value?.becSeral ?? '');
  }, [open, value]);

  const closeDialog = () => {
    if (saving) return;
    onClose();
  };

  // Treat empty strings as "no value" — the proc accepts nulls and we
  // don't want to write whitespace into the BEC columns.
  const blank = (s: string) => (s.trim() ? s.trim() : null);

  const canSubmit =
    !!zone.trim() ||
    !!subzone.trim() ||
    !!variant.trim() ||
    !!phase.trim() ||
    !!siteSeries.trim() ||
    !!sitePhase.trim() ||
    !!seral.trim();

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({
        bgcZoneCode: blank(zone),
        bgcSubzoneCode: blank(subzone),
        bgcVariant: blank(variant),
        bgcPhase: blank(phase),
        becSiteSeriesCd: blank(siteSeries),
        becSiteSeriesPhaseCd: blank(sitePhase),
        becSeral: blank(seral),
      });
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: editing ? 'Failed to update BGC zone' : 'Failed to add BGC zone',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      modalHeading={editing ? 'Edit BGC zone' : 'Add BGC zone'}
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form fsp-species-modal__form--grid">
        <TextInput
          id="bgc-zone"
          labelText="Zone"
          maxLength={4}
          value={zone}
          disabled={saving}
          onChange={(e) => setZone(e.target.value.toUpperCase())}
        />
        <TextInput
          id="bgc-subzone"
          labelText="Subzone"
          maxLength={3}
          value={subzone}
          disabled={saving}
          onChange={(e) => setSubzone(e.target.value.toLowerCase())}
        />
        <TextInput
          id="bgc-variant"
          labelText="Variant"
          maxLength={1}
          value={variant}
          disabled={saving}
          onChange={(e) => setVariant(e.target.value)}
        />
        <TextInput
          id="bgc-phase"
          labelText="Phase"
          maxLength={1}
          value={phase}
          disabled={saving}
          onChange={(e) => setPhase(e.target.value.toLowerCase())}
        />
        <TextInput
          id="bgc-site-series"
          labelText="Site series"
          maxLength={4}
          value={siteSeries}
          disabled={saving}
          onChange={(e) => setSiteSeries(e.target.value)}
        />
        <TextInput
          id="bgc-site-phase"
          labelText="Site series phase"
          maxLength={3}
          value={sitePhase}
          disabled={saving}
          onChange={(e) => setSitePhase(e.target.value)}
        />
        <TextInput
          id="bgc-seral"
          labelText="Seral"
          maxLength={4}
          value={seral}
          disabled={saving}
          onChange={(e) => setSeral(e.target.value)}
        />
      </div>
      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={saving} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={saving || !canSubmit}
          renderIcon={saving ? SavingIcon : undefined}
          onClick={() => void submit()}
        >
          {saving ? (editing ? 'Saving…' : 'Adding…') : 'Save'}
        </Button>
      </div>
    </Modal>
  );
};

// Small Carbon spinner sized to fit a Button icon slot — matches the
// pattern used in AttachmentsTab / BgcZoneSearchModal.
const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default BgcZoneEditModal;
