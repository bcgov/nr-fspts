import { Link, useLocation } from 'react-router-dom';
import './PageLayout.css';

interface FspTombstoneProps {
  fspId?: string;
  amendNo?: string;
  status?: string;
  orgUnit?: string;
  holder?: string;
  expiryDate?: string;
}

// Tombstone bar shown at top of all FSP sub-pages
export function FspTombstone({
  fspId = '—',
  amendNo = '—',
  status = '—',
  orgUnit = '—',
  holder = '—',
  expiryDate = '—',
}: FspTombstoneProps) {
  return (
    <div className="tombstone">
      <div className="tombstone__field"><span className="tombstone__label">FSP ID</span><span className="tombstone__value">{fspId}</span></div>
      <div className="tombstone__field"><span className="tombstone__label">Amendment #</span><span className="tombstone__value">{amendNo}</span></div>
      <div className="tombstone__field"><span className="tombstone__label">Status</span><span className="tombstone__value">{status}</span></div>
      <div className="tombstone__field"><span className="tombstone__label">Organization unit</span><span className="tombstone__value">{orgUnit}</span></div>
      <div className="tombstone__field"><span className="tombstone__label">Agreement holder</span><span className="tombstone__value">{holder}</span></div>
      <div className="tombstone__field"><span className="tombstone__label">Expiry date</span><span className="tombstone__value">{expiryDate}</span></div>
    </div>
  );
}

// Sub-tab strip shared across FSP pages
const FSP_TABS = [
  { label: 'Information',      to: '/fsp/information' },
  { label: 'Attachments',      to: '/fsp/attachments' },
  { label: 'Stocking Stds',    to: '/fsp/stocking-standards' },
  { label: 'FDU/Map',          to: '/fsp/fdu-map' },
  { label: 'Workflow',         to: '/fsp/workflow' },
  { label: 'History',          to: '/fsp/history' },
];

export function FspTabStrip() {
  const { pathname } = useLocation();
  return (
    <div className="fsp-tabs">
      {FSP_TABS.map(t => (
        <Link
          key={t.to}
          to={t.to}
          className={`fsp-tab ${pathname === t.to ? 'fsp-tab--active' : ''}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
