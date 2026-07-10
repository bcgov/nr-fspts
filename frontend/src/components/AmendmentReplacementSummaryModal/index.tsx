import { Modal } from '@carbon/react';
import { type FC } from 'react';

import { type FspInformation } from '@/services/fspSearch';

import './amendment-summary-modal.scss';

/**
 * Read-only dialog surfaced from the header type-summary card's
 * "View amendment description" / "View replacement request" links.
 * Shows the amendment/replacement change indicators + summary of
 * changes already carried on the FSP record — one component serves
 * both flows (they share the FSP301 field set), the heading and link
 * label are the only difference and are driven off fspAmendmentCode.
 */
interface Props {
  open: boolean;
  fsp: FspInformation | null;
  onClose: () => void;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const yesNo = (value: string | null | undefined): string =>
  value === 'Y' ? 'Yes' : value === 'N' ? 'No' : '—';

const AmendmentReplacementSummaryModal: FC<Props> = ({ open, fsp, onClose }) => {
  const isReplace = (fsp?.fspAmendmentCode ?? '').toUpperCase() === 'RPL';
  const heading = isReplace ? 'Replacement request' : 'Amendment description';

  const rows: Array<[string, string]> = [
    ['Type', dash(fsp?.fspAmendmentDesc)],
    ['Effective date', dash(fsp?.amendmentEfftvDate)],
    ['FDUs updated', yesNo(fsp?.fduUpdateInd)],
    ['Identified areas updated', yesNo(fsp?.identifiedAreasUpdateInd)],
    ['Stocking standards updated', yesNo(fsp?.stockingStandardUpdateInd)],
    ['Approval required', yesNo(fsp?.approvalRequiredInd)],
  ];

  return (
    <Modal
      className="fsp-species-modal"
      open={open}
      passiveModal
      size="sm"
      modalHeading={heading}
      onRequestClose={onClose}
    >
      <dl className="amend-summary">
        {rows.map(([label, value]) => (
          <div className="amend-summary__row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="amend-summary__row amend-summary__row--block">
          <dt>Summary of changes</dt>
          <dd>{dash(fsp?.amendmentReason)}</dd>
        </div>
      </dl>
    </Modal>
  );
};

export default AmendmentReplacementSummaryModal;
