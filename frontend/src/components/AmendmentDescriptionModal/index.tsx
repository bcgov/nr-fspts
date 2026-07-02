import { Button, Loading, Modal, Stack, TextArea, Toggle } from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import {
  amendFsp,
  replaceFsp,
  type FspInformation,
  updateFsp,
} from '@/services/fspSearch';

/**
 * Dialog that covers FSP301 (legacy Amend Information / Replace
 * Information page) as a modal. Captures the four Y/N change
 * indicators + the "Summary of Changes" textarea; saves through the
 * same FSP_300_INFORMATION SAVE proc the main Information edit pane
 * uses, so no new backend wiring is needed — the request just carries
 * the extra fields.
 *
 * <p>One component services both AMD ("Amendment Description") and RPL
 * ("Replacement Description") flows — the only difference is the
 * heading text passed in by the caller. The fspAmendmentCode itself
 * is read off the underlying FSP and surfaces in the title so the user
 * knows which flow they're in.
 */
/**
 * Drives both the editing-only path (existing amendment description
 * tweaked after the fact) and the "kick off a new amendment /
 * replacement" path from the FSP300 header buttons.
 *
 * <ul>
 *   <li><b>edit</b> — operates on the current amendment. Just SAVE.</li>
 *   <li><b>create-amend</b> — calls AMEND first (new draft amendment
 *       row, carry-forward licensees/orgs/etc.), then SAVE on the
 *       proc-assigned amendment number.</li>
 *   <li><b>create-replace</b> — same as create-amend but via REPLACE,
 *       which stamps fsp_amendment_code='RPL' and forces approval-
 *       required.</li>
 * </ul>
 */
type Mode = 'edit' | 'create-amend' | 'create-replace';

interface Props {
  open: boolean;
  fsp: FspInformation | null;
  /** "Amendment Description" or "Replacement Description". */
  heading: string;
  /** Defaults to 'edit' for backwards compat. */
  mode?: Mode;
  onClose: () => void;
  onSaved: (updated: FspInformation) => void;
}

const AMENDMENT_REASON_MAX = 2000;

const AmendmentDescriptionModal: FC<Props> = ({
  open,
  fsp,
  heading,
  mode = 'edit',
  onClose,
  onSaved,
}) => {
  const { display } = useNotification();
  const [busy, setBusy] = useState(false);
  const [fduUpdate, setFduUpdate] = useState(false);
  const [stockingStandardUpdate, setStockingStandardUpdate] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  // Once the AMEND / REPLACE proc has run we hold the proc-assigned
  // amendment number here. A retry of Save after a description SAVE
  // failure must NOT call AMEND/REPLACE a second time, or we'd end up
  // creating a duplicate amendment row.
  const [createdAmendmentNumber, setCreatedAmendmentNumber] =
    useState<string | null>(null);
  const [createdFspIdForAmendment, setCreatedFspIdForAmendment] =
    useState<string | null>(null);

  const isReplace = mode === 'create-replace';
  // Replacements are always ministry-approval-required per FRPA — the
  // legacy FSP304 page renders the checkbox disabled and pre-checked.
  const approvalLocked = isReplace;

  // Reset every time the modal re-opens against a (possibly different)
  // FSP. The legacy form pre-fills from current proc values; for the
  // two create modes we start from the prior amendment's flags so the
  // user sees the same defaults the legacy carry-forward would show.
  useEffect(() => {
    if (!open || !fsp) return;
    setFduUpdate(fsp.fduUpdateInd === 'Y');
    setStockingStandardUpdate(fsp.stockingStandardUpdateInd === 'Y');
    setApprovalRequired(approvalLocked ? true : fsp.approvalRequiredInd === 'Y');
    setAmendmentReason('');
    setReasonError(null);
    setCreatedAmendmentNumber(null);
    setCreatedFspIdForAmendment(null);
  }, [open, fsp, approvalLocked]);

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (!fsp || !fsp.fspId) return;
    const trimmed = amendmentReason.trim();
    if (!trimmed) {
      setReasonError('Summary of Changes is required.');
      return;
    }
    if (trimmed.length > AMENDMENT_REASON_MAX) {
      setReasonError(`Max ${AMENDMENT_REASON_MAX} characters.`);
      return;
    }
    setReasonError(null);
    setBusy(true);
    try {
      // In create modes, kick off AMEND / REPLACE first if we haven't
      // already in this open. The proc assigns the next amendment_number;
      // we cache it so a retry after a description-SAVE failure doesn't
      // run AMEND/REPLACE a second time and create a duplicate row.
      let targetFspId = fsp.fspId;
      let targetAmendmentNumber: string | null = fsp.fspAmendmentNumber;
      if (mode !== 'edit' && createdAmendmentNumber == null) {
        const created = mode === 'create-replace'
          ? await replaceFsp(fsp.fspId)
          : await amendFsp(fsp.fspId);
        targetFspId = created.fspId ?? fsp.fspId;
        targetAmendmentNumber = created.fspAmendmentNumber;
        setCreatedFspIdForAmendment(targetFspId);
        setCreatedAmendmentNumber(targetAmendmentNumber);
      } else if (mode !== 'edit' && createdAmendmentNumber != null) {
        targetFspId = createdFspIdForAmendment ?? fsp.fspId;
        targetAmendmentNumber = createdAmendmentNumber;
      }

      const payload: Partial<FspInformation> = {
        fspAmendmentNumber: targetAmendmentNumber,
        fduUpdateInd: fduUpdate ? 'Y' : 'N',
        // Identified-areas feature removed — the update flag is no
        // longer user-settable; always send 'N'.
        identifiedAreasUpdateInd: 'N',
        stockingStandardUpdateInd: stockingStandardUpdate ? 'Y' : 'N',
        approvalRequiredInd: approvalRequired ? 'Y' : 'N',
        amendmentReason: trimmed,
      };
      const updated = await updateFsp(targetFspId, payload);
      onSaved(updated);
      onClose();
      display({
        kind: 'success',
        title: `${heading} saved.`,
        subtitle: mode !== 'edit' && targetAmendmentNumber
          ? `New amendment number: ${targetAmendmentNumber}`
          : undefined,
        timeout: 6000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: `Failed to save ${heading.toLowerCase()}`,
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 0,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      modalHeading={heading}
      passiveModal
      size="sm"
      className="fsp-species-modal"
      onRequestClose={closeIfIdle}
      preventCloseOnClickOutside
    >
      <Stack gap={5} className="fsp-species-modal__form">
        <Toggle
          id="amend-fdu"
          labelText="FDU changes"
          labelA="No"
          labelB="Yes"
          toggled={fduUpdate}
          disabled={busy}
          onToggle={setFduUpdate}
        />
        <Toggle
          id="amend-stocking"
          labelText="Stocking standard changes"
          labelA="No"
          labelB="Yes"
          toggled={stockingStandardUpdate}
          disabled={busy}
          onToggle={setStockingStandardUpdate}
        />
        <Toggle
          id="amend-approval-required"
          // FSP304 spec: replacements always require ministry approval,
          // so the toggle is locked Yes when the modal is opened in
          // create-replace mode. AMD lets the user pick.
          labelText={
            isReplace
              ? 'Replacement requires ministry approval'
              : 'Does this amendment require approval?'
          }
          labelA="No"
          labelB="Yes"
          toggled={approvalRequired}
          disabled={busy || approvalLocked}
          onToggle={setApprovalRequired}
        />
        <TextArea
          id="amend-reason"
          labelText="Summary of changes *"
          placeholder="Describe the changes being made…"
          maxLength={AMENDMENT_REASON_MAX}
          rows={5}
          value={amendmentReason}
          invalid={!!reasonError}
          invalidText={reasonError ?? ''}
          disabled={busy}
          onChange={(e) => {
            setAmendmentReason(e.target.value);
            if (reasonError) setReasonError(null);
          }}
        />
      </Stack>
      <div className="fsp-species-modal__actions">
        <Button kind="secondary" disabled={busy} onClick={closeIfIdle}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={busy}
          renderIcon={busy ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default AmendmentDescriptionModal;
