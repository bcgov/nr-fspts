import {
  Button,
  Link as CarbonLink,
  Loading,
  RadioButton,
  RadioButtonGroup,
  Stack,
  TextArea,
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { Information } from '@carbon/icons-react';
import { useEffect, useState, type FC } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { useNotification } from '@/context/notification/useNotification';
import {
  amendFsp,
  replaceFsp,
  type FspInformation,
  updateFsp,
} from '@/services/fspSearch';
import './amendment-description-modal.scss';

/**
 * Dialog that covers FSP301 (legacy Amend Information / Replace
 * Information page) as a modal. Captures the Y/N change indicators + the
 * "Summary of changes" textarea; saves through the same
 * FSP_300_INFORMATION SAVE proc the main Information edit pane uses, so
 * no new backend wiring is needed — the request just carries the extra
 * fields.
 *
 * <p>One component services both AMD ("Amend") and RPL ("Replace")
 * flows — the wording (amendment vs replacement) and the approval
 * treatment differ, but the persistence path is shared.
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
  /** "Amend FSP" or "Replace FSP" — the FSP id is appended in-modal. */
  heading: string;
  /** Defaults to 'edit' for backwards compat. */
  mode?: Mode;
  onClose: () => void;
  onSaved: (updated: FspInformation) => void;
}

const SUMMARY_MAX = 500;

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
  // Tri-state Y/N radios — null = not yet answered. "All fields are
  // required", so submit is blocked until each is set.
  const [fduUpdate, setFduUpdate] = useState<boolean | null>(null);
  const [stockingStandardUpdate, setStockingStandardUpdate] = useState<
    boolean | null
  >(null);
  const [approvalRequired, setApprovalRequired] = useState<boolean | null>(null);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  // Once the AMEND / REPLACE proc has run we hold the proc-assigned
  // amendment number here. A retry of Save after a description SAVE
  // failure must NOT call AMEND/REPLACE a second time, or we'd end up
  // creating a duplicate amendment row.
  const [createdAmendmentNumber, setCreatedAmendmentNumber] =
    useState<string | null>(null);
  const [createdFspIdForAmendment, setCreatedFspIdForAmendment] =
    useState<string | null>(null);

  const isReplace = mode === 'create-replace';
  // Amendment vs replacement wording used throughout the copy.
  const noun = isReplace ? 'replacement' : 'amendment';
  // Both the Amend and Replace instances of this modal stay mounted at
  // once (only `open` toggles), so element ids and — critically — radio
  // group `name`s must be namespaced per mode. Otherwise the two
  // dialogs' radios share a group and clicking one toggles the other's
  // hidden input, making them appear unclickable.
  const idp = mode;

  // Reset every time the modal re-opens. "All fields are required" so we
  // start the radios unanswered rather than pre-filling from the prior
  // amendment. Replacements are always ministry-approval-required, so
  // approvalRequired is pinned true there.
  useEffect(() => {
    if (!open) return;
    setFduUpdate(null);
    setStockingStandardUpdate(null);
    setApprovalRequired(isReplace ? true : null);
    setAmendmentReason('');
    setShowErrors(false);
    setCreatedAmendmentNumber(null);
    setCreatedFspIdForAmendment(null);
  }, [open, isReplace]);

  const closeIfIdle = () => {
    if (busy) return;
    onClose();
  };

  const reasonTrimmed = amendmentReason.trim();
  const reasonError =
    reasonTrimmed.length === 0
      ? 'Summary of changes is required.'
      : reasonTrimmed.length > SUMMARY_MAX
        ? `Max ${SUMMARY_MAX} characters.`
        : null;
  const fduError = fduUpdate === null;
  const stockingError = stockingStandardUpdate === null;
  const approvalError = !isReplace && approvalRequired === null;

  const submit = async () => {
    if (!fsp || !fsp.fspId) return;
    if (fduError || stockingError || approvalError || reasonError) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      // In create modes, kick off AMEND / REPLACE first if we haven't
      // already in this open. The proc assigns the next amendment_number;
      // we cache it so a retry after a description-SAVE failure doesn't
      // run AMEND/REPLACE a second time and create a duplicate row.
      let targetFspId = fsp.fspId;
      let targetAmendmentNumber: string | null = fsp.fspAmendmentNumber;
      if (mode !== 'edit' && createdAmendmentNumber == null) {
        // Seed the AMEND / REPLACE proc with the reason + indicators. The
        // proc persists the "summary of changes" onto the new amendment's
        // DRAFT status-history row; the follow-up SAVE drops it, so it has
        // to ride the create call to stick.
        const seed = {
          amendmentReason: reasonTrimmed,
          fduUpdateInd: fduUpdate ? 'Y' : 'N',
          identifiedAreasUpdateInd: 'N',
          stockingStandardUpdateInd: stockingStandardUpdate ? 'Y' : 'N',
          approvalRequiredInd: approvalRequired ? 'Y' : 'N',
        };
        const created = isReplace
          ? await replaceFsp(fsp.fspId, seed)
          : await amendFsp(fsp.fspId, seed);
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
        amendmentReason: reasonTrimmed,
      };
      const updated = await updateFsp(targetFspId, payload);
      onSaved(updated);
      onClose();
      display({
        kind: 'success',
        title: isReplace ? 'Replacement created.' : 'Amendment created.',
        subtitle:
          mode !== 'edit' && targetAmendmentNumber
            ? `New amendment number: ${targetAmendmentNumber}`
            : undefined,
        timeout: 6000,
      });
    } catch (e) {
      display({
        kind: 'error',
        title: `Failed to create ${noun}`,
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 0,
      });
    } finally {
      setBusy(false);
    }
  };

  const submitLabel =
    mode === 'edit'
      ? busy
        ? 'Saving…'
        : 'Save'
      : busy
        ? 'Creating…'
        : 'Create amendment';

  return (
    <Modal
      open={open}
      modalHeading={fsp?.fspId ? `${heading} ${fsp.fspId}` : heading}
      passiveModal
      size="md"
      className="fsp-species-modal amend-modal"
      onRequestClose={closeIfIdle}
      preventCloseOnClickOutside
    >
      <div className="fsp-species-modal__form amend-modal__body">
        <p className="amend-modal__intro">
          Creating {isReplace ? 'a replacement' : 'an amendment'} starts a new
          draft linked to this FSP. The approved plan isn&apos;t changed. All
          fields are required.
        </p>

        {/* Custom info banner rather than Carbon's InlineNotification —
            the latter forbids interactive children, and we need the
            inline "Data submission" link. */}
        <div className="amend-modal__banner" role="note">
          <Information className="amend-modal__banner-icon" size={20} />
          <span>
            If your {noun} includes an XML/GeoJSON file, create it through{' '}
            <CarbonLink as={RouterLink} to="/data-submission">
              Data submission
            </CarbonLink>
          </span>
        </div>

        <div className="amend-modal__questions">
          <div className="amend-modal__question">
            <span className="amend-modal__question-label">
              Does this {noun} change FDU boundaries?
            </span>
            <RadioButtonGroup
              name={`${idp}-fdu`}
              legendText=""
              valueSelected={fduUpdate === null ? '' : fduUpdate ? 'Y' : 'N'}
              onChange={(v) => setFduUpdate(v === 'Y')}
              disabled={busy}
            >
              <RadioButton id={`${idp}-fdu-yes`} labelText="Yes" value="Y" />
              <RadioButton id={`${idp}-fdu-no`} labelText="No" value="N" />
            </RadioButtonGroup>
          </div>
          {showErrors && fduError && (
            <p className="amend-modal__error">Select an option.</p>
          )}

          <hr className="amend-modal__divider" />

          <div className="amend-modal__question">
            <span className="amend-modal__question-label">
              Does this {noun} change stocking standards?
            </span>
            <RadioButtonGroup
              name={`${idp}-stocking`}
              legendText=""
              valueSelected={
                stockingStandardUpdate === null
                  ? ''
                  : stockingStandardUpdate
                    ? 'Y'
                    : 'N'
              }
              onChange={(v) => setStockingStandardUpdate(v === 'Y')}
              disabled={busy}
            >
              <RadioButton id={`${idp}-stocking-yes`} labelText="Yes" value="Y" />
              <RadioButton id={`${idp}-stocking-no`} labelText="No" value="N" />
            </RadioButtonGroup>
          </div>
          {showErrors && stockingError && (
            <p className="amend-modal__error">Select an option.</p>
          )}
        </div>

        {isReplace ? (
          <div className="amend-modal__approval">
            <p className="amend-modal__approval-title">Approval</p>
            <p className="amend-modal__approval-desc">
              Replacement amendments require approval. The district reviews the
              replacement and makes a decision.
            </p>
          </div>
        ) : (
          <div className="amend-modal__approval">
            <p className="amend-modal__approval-title">
              Does this amendment require approval?
            </p>
            <RadioButtonGroup
              name={`${idp}-approval`}
              legendText=""
              valueSelected={
                approvalRequired === null ? '' : approvalRequired ? 'Y' : 'N'
              }
              onChange={(v) => setApprovalRequired(v === 'Y')}
              disabled={busy}
            >
              <RadioButton id={`${idp}-approval-yes`} labelText="Yes" value="Y" />
              <RadioButton id={`${idp}-approval-no`} labelText="No" value="N" />
            </RadioButtonGroup>
            {showErrors && approvalError && (
              <p className="amend-modal__error">Select an option.</p>
            )}
          </div>
        )}

        <Stack gap={3}>
          <TextArea
            id={`${idp}-reason`}
            labelText="Summary of changes"
            placeholder="Describe the changes being made…"
            enableCounter
            maxCount={SUMMARY_MAX}
            rows={4}
            value={amendmentReason}
            invalid={showErrors && !!reasonError}
            invalidText={reasonError ?? ''}
            disabled={busy}
            onChange={(e) => setAmendmentReason(e.target.value)}
          />
        </Stack>
      </div>

      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={busy} onClick={closeIfIdle}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={busy}
          renderIcon={busy ? BusyIcon : undefined}
          onClick={() => void submit()}
        >
          {submitLabel}
        </Button>
      </div>
    </Modal>
  );
};

const BusyIcon = () => <Loading small withOverlay={false} description="" />;

export default AmendmentDescriptionModal;
