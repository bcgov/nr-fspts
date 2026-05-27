import { Link } from 'react-router-dom';
import PageLayout from './PageLayout';
import './PageLayout.css';

interface WelcomePageProps {
  userName?: string;
}

export default function WelcomePage({ userName }: WelcomePageProps) {
  const links = [
    { label: 'FSP Information Support Project', url: 'https://www.for.gov.bc.ca/his/fsp/' },
    { label: 'Forest and Range Practices Act', url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02069_00' },
    { label: 'Forest Planning and Practices Regulation', url: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004' },
    { label: 'FSP Tracking Project', url: 'https://www.for.gov.bc.ca/his/fsp/' },
  ];

  return (
    <PageLayout title="Welcome">
      <div className="welcome-meta">
        <span><strong>User:</strong> {userName || '—'}</span>
      </div>

      <p className="welcome-intro">
        The FSP Tracking System accepts and tracks Forest Stewardship Plans submitted
        electronically to the Ministry of Forests and Range.
      </p>

      <h2 className="welcome-subhead">What do you want to do?</h2>
      <ul className="welcome-list">
        <li>To search for any FSP that has passed through the system, click <Link to="/search"><strong>Search</strong></Link></li>
        <li>To display a list of all FSPs submitted in your district, click <Link to="/inbox"><strong>Inbox</strong></Link></li>
        <li>To prepare and submit an FSP on line, select <Link to="/fsp/information"><strong>FSP → FSP Information</strong></Link></li>
        <li>To submit an FSP as an XML/GML file, select <Link to="/data-submission/xml"><strong>Data Submission → XML Submission</strong></Link></li>
      </ul>

      <h2 className="welcome-subhead">External Links</h2>
      <ul className="welcome-list">
        {links.map(l => (
          <li key={l.label}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
          </li>
        ))}
      </ul>

      <style>{`
        .welcome-meta { font-size: 0.85rem; color: #525252; margin-bottom: 1.25rem; display: flex; gap: 2rem; }
        .welcome-intro { margin-bottom: 1.25rem; color: #313132; line-height: 1.6; }
        .welcome-subhead { font-size: 1rem; font-weight: 700; color: #003366; margin: 1.5rem 0 0.5rem; }
        .welcome-list { padding-left: 1.5rem; line-height: 2; color: #313132; font-size: 0.9rem; }
        .welcome-list a { color: #0f62fe; }
      `}</style>
    </PageLayout>
  );
}
