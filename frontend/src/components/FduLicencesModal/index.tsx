import { Button, Loading, Stack, Tag, TextInput } from '@carbon/react';
import { Modal } from '@/components/Modal';
import { Add, Close } from '@carbon/icons-react';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { useAutoFocusOnOpen } from '@/hooks/useAutoFocusOnOpen';
import { checkLicenceExists, updateFduLicences } from '@/services/fspSearch';

/**
 * Dialog for editing the licence numbers attached to a single FDU.
 * The caller (MapTab) handles status/role gating before showing the
 * "Edit licences" button — this modal trusts that gate and lets the
 * user stage adds / removes, then submits a single PUT to the backend.
 *
 * <p>Removals work on the licence list snapshot the dialog opens with;
 * additions are validated server-side against {@code PROV_FOREST_USE}.
 */
interface Props {
  open: boolean;
  fspId: string;
  fduId: string;
  fduName: string;
  /** Current licence list (comma-joined string from the FDU row). */
  initialLicences: string;
  onClose: () => void;
  /** Called with the refreshed licence list on success. */
  onSaved: (licences: string[]) => void;
}

const splitCsv = (csv: string): string[] =>
  csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const FduLicencesModal: FC<Props> = ({
  open,
  fspId,
  fduId,
  fduName,
  initialLicences,
  onClose,
  onSaved,
}) => {
  const { display } = useNotification();
  const initialSet = useMemo(
    () => splitCsv(initialLicences).map((l) => l.toUpperCase()),
    [initialLicences],
  );

  // Working state — kept relative to initialSet so we can compute the
  // add/remove payload at submit time without tracking it incrementally.
  const [kept, setKept] = useState<string[]>(initialSet);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Focus the licence-number field on open. Carbon's own modal-open focus
  // pass lands on the Close (X) button here, so re-apply across the open
  // cycle via the shared hook.
  const licenceInputRef = useRef<HTMLInputElement>(null);
  useAutoFocusOnOpen(licenceInputRef, open);

  useEffect(() => {
    if (!open) return;
    setKept(initialSet);
    setAdded([]);
    setDraft('');
    setDraftError(null);
    setChecking(false);
    setSubmitting(false);
  }, [open, initialSet]);

  // Removing a current licence doesn't drop it from view — it flips to a
  // struck-through "Removed" chip (kept out of `kept`) so the user can see
  // what will be deleted on save and Undo it. restoreKept reverses that.
  const removeKept = (lic: string) =>
    setKept((cur) => cur.filter((l) => l !== lic));
  const restoreKept = (lic: string) =>
    setKept((cur) => (cur.includes(lic) ? cur : [...cur, lic]));
  const removeAdded = (lic: string) =>
    setAdded((cur) => cur.filter((l) => l !== lic));

  // Validate on Add rather than at save: cheap client checks first (empty /
  // duplicate), then confirm the number exists in PROV_FOREST_USE before
  // staging it. This catches a bad licence immediately instead of failing
  // the whole batch when the user clicks Save changes.
  const stageAdd = async () => {
    const v = draft.trim().toUpperCase();
    if (!v) {
      setDraftError('Enter a licence number to add.');
      return;
    }
    if (kept.includes(v) || added.includes(v)) {
      setDraftError(`${v} is already in this FDU.`);
      return;
    }
    setChecking(true);
    setDraftError(null);
    try {
      const exists = await checkLicenceExists(fspId, v);
      if (!exists) {
        setDraftError(
          'Licence not found in the provincial forest-use registry. Check the '
            + 'format (e.g. A12345) and try again.',
        );
        return;
      }
      setAdded((cur) => [...cur, v]);
      setDraft('');
    } catch {
      setDraftError('Could not validate the licence number. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const removedLicences = initialSet.filter((l) => !kept.includes(l));
  const dirty = added.length > 0 || removedLicences.length > 0;

  const submit = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      const res = await updateFduLicences(fspId, fduId, {
        add: added,
        remove: removedLicences,
      });
      display({
        kind: 'success',
        title: 'FDU licences updated',
        subtitle: `${fduName}: ${res.added} added, ${res.removed} removed${
          res.skippedAlreadyPresent > 0
            ? `, ${res.skippedAlreadyPresent} skipped`
            : ''
        }`,
        timeout: 6000,
      });
      onSaved(res.licences);
      onClose();
    } catch (e) {
      display({
        kind: 'error',
        title: 'Unable to update licences',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 9000,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const closeIfIdle = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      modalHeading={`Edit licences: ${fduName}`}
      passiveModal
      size="sm"
      className="fsp-species-modal fdu-licences-modal"
      onRequestClose={closeIfIdle}
      preventCloseOnClickOutside
    >
      <Stack gap={5} className="fsp-species-modal__form">
        <p className="fdu-licences-modal__hint">
          Add or remove licence numbers attached to this FDU. Changes apply
          when you save.
        </p>

        <div>
          <h4 className="fdu-licences-modal__group-label">Current licences</h4>
          {initialSet.length === 0 && added.length === 0 ? (
            <p className="fdu-licences-modal__hint">No licences attached.</p>
          ) : (
            <div className="fdu-licences-modal__chip-row">
              {initialSet.map((lic) =>
                kept.includes(lic) ? (
                  <Tag
                    key={`kept-${lic}`}
                    type="gray"
                    filter
                    onClose={() => removeKept(lic)}
                    title={`Remove ${lic}`}
                  >
                    {lic}
                  </Tag>
                ) : (
                  <span
                    key={`removed-${lic}`}
                    className="fdu-licences-modal__chip fdu-licences-modal__chip--removed"
                  >
                    <span className="fdu-licences-modal__chip-lic">{lic}</span>
                    <span className="fdu-licences-modal__chip-state">
                      • Removed
                    </span>
                    <button
                      type="button"
                      className="fdu-licences-modal__chip-undo"
                      onClick={() => restoreKept(lic)}
                      disabled={submitting}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="fdu-licences-modal__chip-x"
                      aria-label={`Undo removal of ${lic}`}
                      title={`Undo removal of ${lic}`}
                      onClick={() => restoreKept(lic)}
                      disabled={submitting}
                    >
                      <Close />
                    </button>
                  </span>
                ),
              )}
              {added.map((lic) => (
                <Tag
                  key={`add-${lic}`}
                  type="green"
                  filter
                  onClose={() => removeAdded(lic)}
                  title={`Cancel addition of ${lic}`}
                >
                  {lic} • New
                </Tag>
              ))}
            </div>
          )}
        </div>

        <div className="fdu-licences-modal__inline-form">
          <TextInput
            id="fdu-licence-add"
            ref={licenceInputRef}
            labelText="Add a licence number"
            helperText="Format: letter followed by 5 digits, e.g. A12345"
            value={draft}
            invalid={!!draftError}
            invalidText={draftError ?? ''}
            onChange={(e) => {
              setDraft(e.target.value);
              if (draftError) setDraftError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void stageAdd();
              }
            }}
            disabled={submitting || checking}
          />
          <Button
            kind="tertiary"
            size="md"
            renderIcon={checking ? BusyIcon : Add}
            onClick={() => void stageAdd()}
            disabled={submitting || checking || draft.trim() === ''}
          >
            {checking ? 'Checking…' : 'Add licence'}
          </Button>
        </div>
      </Stack>

      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={submitting} onClick={closeIfIdle}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={submitting || !dirty}
          renderIcon={submitting ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {submitting ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default FduLicencesModal;
