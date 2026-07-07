import {
  Button,
  ComboBox,
  Loading,
  Modal,
  Stack,
} from '@carbon/react';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
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
  // Tracks whether we've kicked off the lazy load yet so the effect
  // can stay dep'd only on `open`. (An earlier version included
  // `orgUnitsLoading` in the deps, which re-ran the effect when we
  // flipped the flag to true — the cleanup cancelled the in-flight
  // fetch and the loading flag never cleared.)
  const fetchStarted = useRef(false);

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

  const closeDialog = () => {
    if (saving) return;
    setSelected(null);
    onClose();
  };

  const submit = async () => {
    if (!selected) return;
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
        <ComboBox
          id="add-district-combobox"
          titleText="District *"
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
          onChange={({ selectedItem }) => setSelected(selectedItem ?? null)}
          disabled={saving || orgUnitsLoading || available.length === 0}
        />
      </Stack>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={saving} onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={saving || !selected}
          renderIcon={saving ? SavingIcon : undefined}
          onClick={() => void submit()}
        >
          {saving ? 'Adding…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
};

// Small Carbon spinner sized to fit a Button icon slot — matches the
// pattern used in AttachmentsTab / BgcZoneSearchModal.
const SavingIcon = () => <Loading small withOverlay={false} description="" />;

export default DistrictPickerModal;
