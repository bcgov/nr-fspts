import {
  Button,
  InlineNotification,
  Modal,
  Stack,
  Tag,
  TextInput,
} from '@carbon/react';
import { Add, TrashCan } from '@carbon/icons-react';
import { useEffect, useMemo, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { updateFduLicences } from '@/services/fspSearch';

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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKept(initialSet);
    setAdded([]);
    setDraft('');
    setDraftError(null);
    setSubmitting(false);
  }, [open, initialSet]);

  const removeKept = (lic: string) =>
    setKept((cur) => cur.filter((l) => l !== lic));
  const removeAdded = (lic: string) =>
    setAdded((cur) => cur.filter((l) => l !== lic));

  const stageAdd = () => {
    const v = draft.trim().toUpperCase();
    if (!v) {
      setDraftError('Enter a licence number to add.');
      return;
    }
    if (kept.includes(v) || added.includes(v)) {
      setDraftError(`${v} is already in this FDU.`);
      return;
    }
    setAdded((cur) => [...cur, v]);
    setDraft('');
    setDraftError(null);
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

  return (
    <Modal
      open={open}
      modalHeading={`Edit licences — ${fduName}`}
      modalLabel="FDU"
      primaryButtonText={submitting ? 'Saving…' : 'Save changes'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={submitting || !dirty}
      onRequestClose={() => {
        if (submitting) return;
        onClose();
      }}
      onRequestSubmit={() => {
        void submit();
      }}
      size="sm"
      className="fsp-species-modal fdu-licences-modal"
    >
      <Stack gap={5}>
        <p className="fdu-licences-modal__hint">
          Add or remove licence numbers attached to this FDU. New licence
          numbers must already exist in the provincial forest-use registry.
        </p>

        <div>
          <h4 className="fdu-licences-modal__group-label">Current licences</h4>
          {kept.length === 0 && added.length === 0 ? (
            <p className="fdu-licences-modal__hint">No licences attached.</p>
          ) : (
            <div className="fdu-licences-modal__chip-row">
              {kept.map((lic) => (
                <Tag
                  key={`kept-${lic}`}
                  type="gray"
                  filter
                  onClose={() => removeKept(lic)}
                  title={`Remove ${lic}`}
                >
                  {lic}
                </Tag>
              ))}
              {added.map((lic) => (
                <Tag
                  key={`add-${lic}`}
                  type="green"
                  filter
                  onClose={() => removeAdded(lic)}
                  title={`Cancel addition of ${lic}`}
                >
                  {lic} (new)
                </Tag>
              ))}
            </div>
          )}
        </div>

        {removedLicences.length > 0 && (
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title="Pending removals"
            subtitle={removedLicences.join(', ')}
          />
        )}

        <div className="fdu-licences-modal__inline-form">
          <TextInput
            id="fdu-licence-add"
            labelText="Add a licence number"
            placeholder="e.g. A12345"
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
                stageAdd();
              }
            }}
            disabled={submitting}
          />
          <Button
            kind="tertiary"
            size="md"
            renderIcon={Add}
            onClick={stageAdd}
            disabled={submitting || draft.trim() === ''}
          >
            Add
          </Button>
        </div>

        {dirty && (
          <p className="fdu-licences-modal__hint">
            <TrashCan size={14} aria-hidden /> Pending changes — click Save
            changes to apply.
          </p>
        )}
      </Stack>
    </Modal>
  );
};

export default FduLicencesModal;
