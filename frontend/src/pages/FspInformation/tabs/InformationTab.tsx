import type {FC} from 'react';

import type {FspInformation} from '@/services/fspSearch';

interface Props {
  fsp: FspInformation | null;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const yesNo = (value: string | null | undefined): string => {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return 'No';
  return '—';
};

interface FieldEntry {
  label: string;
  value: string;
}

const Field: FC<FieldEntry> = ({ label, value }) => (
  <div className="fsp-info__field">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

const InformationTab: FC<Props> = ({ fsp }) => {
  if (!fsp) return null;

  const planDetails: FieldEntry[] = [
    { label: 'FSP Name', value: dash(fsp.fspPlanName) },
    { label: 'Status', value: dash(fsp.fspStatusDesc) },
    { label: 'Amendment Name', value: dash(fsp.amendmentName) },
    { label: 'Amendment Type', value: dash(fsp.fspAmendmentDesc) },
    { label: 'Amendment Authority', value: dash(fsp.amendmentAuthority) },
    { label: 'Revision', value: dash(fsp.revisionCount) },
  ];

  const termAndDates: FieldEntry[] = [
    { label: 'Effective Date', value: dash(fsp.fspPlanStartDate) },
    { label: 'Expiry Date', value: dash(fsp.fspExpiryDate) },
    { label: 'Submission Date', value: dash(fsp.fspPlanSubmissionDate) },
    { label: 'Term (Years)', value: dash(fsp.fspPlanTermYears) },
    { label: 'Term (Months)', value: dash(fsp.fspPlanTermMonths) },
    { label: 'Plan End Date', value: dash(fsp.fspPlanEndDate) },
  ];

  const flags: FieldEntry[] = [
    { label: 'Transitional FSP', value: yesNo(fsp.transitionInd) },
    { label: 'FRPA 197 Election', value: yesNo(fsp.frpa197electionInd) },
  ];

  const contact: FieldEntry[] = [
    { label: 'Contact Name', value: dash(fsp.fspContactName) },
    { label: 'Telephone', value: dash(fsp.fspTelephoneNumber) },
    { label: 'E-mail Address', value: dash(fsp.fspEmailAddress) },
  ];

  const agreementHolders = fsp.agreementHolders ?? [];
  const districts = fsp.districts ?? [];

  return (
    <div className="fsp-info__tiles-grid">
      <section className="fsp-info__tile">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">Plan Details</h2>
        </header>
        <dl className="fsp-info__field-list">
          {planDetails.map((f) => (
            <Field key={f.label} {...f} />
          ))}
        </dl>
      </section>

      <section className="fsp-info__tile">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">Term &amp; Dates</h2>
        </header>
        <dl className="fsp-info__field-list">
          {termAndDates.map((f) => (
            <Field key={f.label} {...f} />
          ))}
        </dl>
      </section>

      <section className="fsp-info__tile">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">Contact</h2>
        </header>
        <dl className="fsp-info__field-list">
          {contact.map((f) => (
            <Field key={f.label} {...f} />
          ))}
        </dl>
      </section>

      <section className="fsp-info__tile">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">Flags</h2>
        </header>
        <dl className="fsp-info__field-list">
          {flags.map((f) => (
            <Field key={f.label} {...f} />
          ))}
        </dl>
      </section>

      <section className="fsp-info__tile fsp-info__tile--full">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">
            Agreement Holders ({agreementHolders.length})
          </h2>
        </header>
        {agreementHolders.length === 0 ? (
          <p>No agreement holders linked to this FSP.</p>
        ) : (
          <dl className="fsp-info__field-list">
            {agreementHolders.map((h) => (
              <div key={`${h.clientNumber}-${h.agreementDescription}`} className="fsp-info__field">
                <dt>
                  {dash(h.clientNumber)} — {dash(h.clientName)}
                </dt>
                <dd>{dash(h.agreementDescription)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="fsp-info__tile fsp-info__tile--full">
        <header className="fsp-info__tile-header">
          <h2 className="fsp-info__section-title">Districts ({districts.length})</h2>
        </header>
        {districts.length === 0 ? (
          <p>No districts linked to this FSP.</p>
        ) : (
          <dl className="fsp-info__field-list">
            {districts.map((d) => (
              <div key={d.orgUnitNo ?? d.orgUnitCode ?? ''} className="fsp-info__field">
                <dt>{dash(d.orgUnitCode)}</dt>
                <dd>{dash(d.orgUnitName)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
};

export default InformationTab;
