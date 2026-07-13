import {
  Button,
  ComboBox,
  Loading,
  Stack,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { useAutoFocusOnOpen } from '@/hooks/useAutoFocusOnOpen';
import { type CodeOption, getOrgUnits } from '@/services/fspSearch';

interface DistrictPickerModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * org_unit_no values already on the FSP — filtered out of the
   * dropdown options. The lookup cursor surfaces org_unit_no as
   * {@code CodeOption.code} (description is "ORG_CODE - NAME"), so
   * dedup has to compare against the numeric, not the 3-letter code.
   */
  excludeOrgUnitNos: string[];
  /** Called with the picked district when Save is clicked. The
   *  parent handles persistence + closes the modal. */
  onSelect: (district: CodeOption) => Promise<void> | void;
}

/**
 * Carbon ComboBox-backed picker — type to filter, click Save to add.
 * Same dialog shell as the Add Species / Add Attachment dialogs:
 * size="sm" + passiveModal + custom Cancel/Save action row.
 */
const DistrictPickerModal: FC<DistrictPickerModalProps> = ({
  open,
  onClose,
  excludeOrgUnitNos,
  onSelect,
}) => {
  const { display } = useNotification();
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [orgUnitsLoading, setOrgUnitsLoading] = useState(false);
  const [selected, setSelected] = useState<CodeOption | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when the user clicks Add district without a selection — surfaces
  // the "This field is required" message on the ComboBox.
  const [showRequired, setShowRequired] = useState(false);
  // Tracks whether we've kicked off the lazy load yet so the effect
  // can stay dep'd only on `open`. (An earlier version included
  // `orgUnitsLoading` in the deps, which re-ran the effect when we
  // flipped the flag to true — the cleanup cancelled the in-flight
  // fetch and the loading flag never cleared.)
  const fetchStarted = useRef(false);
  // The ComboBox is disabled while its options load, so Carbon can't
  // focus it on open. Drive focus ourselves once it's enabled (see the
  // useAutoFocusOnOpen call below the `available` memo).
  const comboRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || fetchStarted.current) return;
    fetchStarted.current = true;
    let cancelled = false;
    setOrgUnitsLoading(true);
    getOrgUnits()
      .then((rows) => {
        if (!cancelled) setOrgUnits(rows);
      })
      .catch(() => {
        if (!cancelled) setOrgUnits([]);
      })
      .finally(() => {
        if (!cancelled) setOrgUnitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Filter out org_unit_no values already on the FSP so the user can't duplicate.
  const available = useMemo(() => {
    const used = new Set(excludeOrgUnitNos);
    return orgUnits.filter((o) => o.code != null && !used.has(o.code));
  }, [orgUnits, excludeOrgUnitNos]);

  // Focus the combo once the modal is open and its options have loaded
  // (it's disabled until then). Re-arms on every open, including reopens
  // where the options are already cached.
  useAutoFocusOnOpen(comboRef, open && !orgUnitsLoading && available.length > 0);

  const closeDialog = () => {
    if (saving) return;
    setSelected(null);
    setShowRequired(false);
    onClose();
  };

  const submit = async () => {
    if (!selected) {
      setShowRequired(true);
      return;
    }
    setSaving(true);
    try {
      await onSelect(selected);
      setSelected(null);
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Failed to add district',
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
      modalHeading="Add district"
      passiveModal
      size="sm"
      className="fsp-species-modal fsp-species-modal--overflow-visible"
      onRequestClose={closeDialog}
      preventCloseOnClickOutside
    >
      <Stack gap={5} className="fsp-species-modal__form">
        <p className="fsp-species-modal__subtitle">
          Select a district to add to this FSP
        </p>
        <ComboBox
          ref={comboRef}
          id="add-district-combobox"
          titleText="District"
          invalid={showRequired}
          invalidText="This field is required"
          placeholder={
            orgUnitsLoading
              ? 'Loading…'
              : available.length === 0
                ? 'No districts left to add'
                : 'Type to filter…'
          }
          items={available}
          itemToString={(item) =>
            // `code` here is the org_unit_no (numeric) — the cursor
            // returns it that way, with description = "CODE - NAME".
            // Show only the description so the dropdown reads cleanly
            // ("DCK - Chilliwack Natural Resource District") instead
            // of leaking the internal id ("15 — DCK - …").
            item ? (item.description ?? item.code ?? '') : ''
          }
          shouldFilterItem={({ item, inputValue }) => {
            // Carbon's default is "show everything" — supply our own
            // case-insensitive substring match against the visible
            // label so typing actually narrows the list.
            if (!inputValue) return true;
            const label = (item?.description ?? item?.code ?? '').toLowerCase();
            return label.includes(inputValue.toLowerCase());
          }}
          selectedItem={selected}
          onChange={({ selectedItem }) => {
            setSelected(selectedItem ?? null);
            if (selectedItem) setShowRequired(false);
          }}
          disabled={saving || orgUnitsLoading || available.length === 0}
        />
      </Stack>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={saving} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={saving}
          renderIcon={saving ? SavingIcon : undefined}
          onClick={() => void submit()}
        >
          {saving ? 'Adding…' : 'Add district'}
        </Button>
      </div>
    </Modal>
  );
};

// Small Carbon spinner sized to fit a Button icon slot — matches the
// pattern used in AttachmentsTab / BgcZoneSearchModal.
const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default DistrictPickerModal;
