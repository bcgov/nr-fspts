import { CheckmarkFilled, SubtractFilled } from '@carbon/icons-react';
import { Modal } from '@/components/Modal';
import { type FC } from 'react';

import { type FspInformation } from '@/services/fspSearch';

import './amendment-summary-modal.scss';

/**
 * Read-only dialog surfaced from the header type-summary card's
 * "View amendment description" / "View replacement request" links.
 * Shows the amendment/replacement change indicators, whether approval
 * was required, and the licensee's summary of changes — all carried on
 * the FSP record. One component serves both flows (they share the FSP301
 * field set); the wording (amendment vs replacement) is driven off
 * fspAmendmentCode.
 */
interface Props {
  open: boolean;
  fsp: FspInformation | null;
  onClose: () => void;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Amendment 0 is the original plan; everything this modal opens for is a
// later version, but guard anyway.
const versionLabel = (value: string | null | undefined): string => {
  if (value == null || value.trim() === '') return '—';
  return Number(value) === 0 ? 'Original' : value.trim();
};

/** One "X updated" / "X — unchanged" indicator line with its status icon. */
const ChangeRow: FC<{ updated: boolean; label: string }> = ({
  updated,
  label,
}) => (
  <li className="amend-summary__change">
    {updated ? (
      <CheckmarkFilled
        size={20}
        className="amend-summary__change-icon amend-summary__change-icon--yes"
      />
    ) : (
      <SubtractFilled
        size={20}
        className="amend-summary__change-icon amend-summary__change-icon--no"
      />
    )}
    <span>{updated ? `${label} updated` : `${label} — unchanged`}</span>
  </li>
);

const AmendmentReplacementSummaryModal: FC<Props> = ({ open, fsp, onClose }) => {
  const isReplace = (fsp?.fspAmendmentCode ?? '').toUpperCase() === 'RPL';
  const noun = isReplace ? 'replacement' : 'amendment';
  const Noun = isReplace ? 'Replacement' : 'Amendment';

  const planName = fsp?.fspPlanName?.trim() || '—';
  const context = `FSP ${dash(fsp?.fspId)} · ${planName}`;
  const heading = `Version ${versionLabel(fsp?.fspAmendmentNumber)} — ${Noun} description`;

  const stockingUpdated = fsp?.stockingStandardUpdateInd === 'Y';
  const fduUpdated = fsp?.fduUpdateInd === 'Y';
  const approvalRequired = fsp?.approvalRequiredInd === 'Y';

  return (
    <Modal
      className="fsp-species-modal amend-summary-modal"
      open={open}
      passiveModal
      size="md"
      modalLabel={context}
      modalHeading={heading}
      onRequestClose={onClose}
    >
      <div className="amend-summary">
        <div className="amend-summary__card">
          <p className="amend-summary__card-title">Changes in this {noun}</p>
          <ul className="amend-summary__changes">
            <ChangeRow updated={stockingUpdated} label="Stocking standards" />
            <ChangeRow updated={fduUpdated} label="FDU boundaries" />
          </ul>
        </div>

        <section className="amend-summary__section">
          <h3 className="amend-summary__heading">Approval</h3>
          <p className="amend-summary__text">
            {approvalRequired
              ? `Required — the district decision maker reviews all ${noun}s before they take effect.`
              : `Not required — this ${noun} took effect when it was submitted.`}
          </p>
        </section>

        <section className="amend-summary__section">
          <h3 className="amend-summary__heading">Summary of changes</h3>
          <p className="amend-summary__text amend-summary__text--wrap">
            {dash(fsp?.amendmentReason)}
          </p>
        </section>
      </div>
    </Modal>
  );
};

export default AmendmentReplacementSummaryModal;
