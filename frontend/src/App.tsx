import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import Layout from './components/Layout';
import { startLogin } from './auth/auth';
import { useSession } from './auth/useSession';

// Pages
import AuthCallbackPage         from './pages/AuthCallbackPage';
import WelcomePage              from './pages/WelcomePage';
import SearchPage               from './pages/SearchPage';
import InboxPage                from './pages/InboxPage';
import FspInformationPage       from './pages/FspInformationPage';
import AmendInformationPage     from './pages/AmendInformationPage';
import ExtensionRequestPage     from './pages/ExtensionRequestPage';
import ExtensionSummaryPage     from './pages/ExtensionSummaryPage';
import ReplaceInformationPage   from './pages/ReplaceInformationPage';
import AttachmentsPage          from './pages/AttachmentsPage';
import StockingStandardsPage    from './pages/StockingStandardsPage';
import FduMapPage               from './pages/FduMapPage';
import IdentifiedAreasPage      from './pages/IdentifiedAreasPage';
import WorkflowPage             from './pages/WorkflowPage';
import HistoryPage              from './pages/HistoryPage';
import DistrictNotificationPage from './pages/DistrictNotificationPage';
import XmlSubmissionPage        from './pages/XmlSubmissionPage';
import JcrsReportsPage          from './pages/JcrsReportsPage';

import './App.css';

const AUTH_IDP_IDIR  = import.meta.env.VITE_AUTH_IDP_IDIR;
const AUTH_IDP_BCEID = import.meta.env.VITE_AUTH_IDP_BCEID;

// ── Login Page ─────────────────────────────────────────────
function LoginPage() {
  return (
    <main className="login-page" id="main-content">
      <div className="login-card">
        <div className="login-card__logo-wrap">
          <img src="/BCID_H_RGB_pos.png" alt="Government of British Columbia" className="login-card__logo" />
        </div>
        <h1 className="login-card__title">Forest Stewardship Plan</h1>
        <p className="login-card__subtitle">
          Sign in with your BC Government account to access and manage your plans.
        </p>

        <button type="button" onClick={() => startLogin(AUTH_IDP_IDIR)} className="login-card__btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="20" height="20" aria-hidden="true" className="login-card__btn-icon">
            <rect x="0"  y="0"  width="10" height="10" fill="#f25022"/>
            <rect x="11" y="0"  width="10" height="10" fill="#7fba00"/>
            <rect x="0"  y="11" width="10" height="10" fill="#00a4ef"/>
            <rect x="11" y="11" width="10" height="10" fill="#ffb900"/>
          </svg>
          Log in with IDIR
        </button>

        <div className="login-card__divider"><span>or</span></div>

        <button type="button" onClick={() => startLogin(AUTH_IDP_BCEID)} className="login-card__btn login-card__btn--secondary">
          <img src="/bcid-192x192.png" alt="" aria-hidden="true" className="login-card__btn-icon login-card__btn-icon--bcid" />
          Log in with Business BCeID
        </button>

        <p className="login-card__help">
          Need help? <a href="#" className="login-card__link">Contact support</a>
        </p>
      </div>
    </main>
  );
}

// Wraps a page in the Carbon UI Shell. Used inline so the route table reads
// like REPT's — `element={withLayout(<Page />)}` — without a per-page edit.
const withLayout = (node: ReactNode) => <Layout>{node}</Layout>;

// ── App ────────────────────────────────────────────────────
export default function App() {
  const session = useSession();
  const isLoggedIn = !!session;
  const userName = session?.user?.name ?? '';

  return (
    <BrowserRouter>
      {isLoggedIn ? (
        <Routes>
          {/* Stale callback URL while already signed in: just go home. */}
          <Route path="/auth/callback"          element={<Navigate to="/welcome" replace />} />

          <Route path="/"                       element={<Navigate to="/welcome" replace />} />
          <Route path="/welcome"                element={withLayout(<WelcomePage userName={userName} />)} />

          {/* Search */}
          <Route path="/search"                 element={withLayout(<SearchPage />)} />
          <Route path="/links/fta"              element={withLayout(<WelcomePage userName={userName} />)} />
          <Route path="/links/results"          element={withLayout(<WelcomePage userName={userName} />)} />
          <Route path="/links/mapview"          element={withLayout(<WelcomePage userName={userName} />)} />
          <Route path="/links/cims"             element={withLayout(<WelcomePage userName={userName} />)} />

          {/* Inbox */}
          <Route path="/inbox"                  element={withLayout(<InboxPage />)} />

          {/* FSP */}
          <Route path="/fsp/information"        element={withLayout(<FspInformationPage />)} />
          <Route path="/fsp/amend-information"  element={withLayout(<AmendInformationPage />)} />
          <Route path="/fsp/extension-request"  element={withLayout(<ExtensionRequestPage />)} />
          <Route path="/fsp/extension-summary"  element={withLayout(<ExtensionSummaryPage />)} />
          <Route path="/fsp/replace-information" element={withLayout(<ReplaceInformationPage />)} />
          <Route path="/fsp/attachments"        element={withLayout(<AttachmentsPage />)} />
          <Route path="/fsp/stocking-standards" element={withLayout(<StockingStandardsPage />)} />
          <Route path="/fsp/fdu-map"            element={withLayout(<FduMapPage />)} />
          <Route path="/fsp/identified-areas"   element={withLayout(<IdentifiedAreasPage />)} />
          <Route path="/fsp/workflow"           element={withLayout(<WorkflowPage />)} />
          <Route path="/fsp/history"            element={withLayout(<HistoryPage />)} />

          {/* Data Submission */}
          <Route path="/data-submission/xml"    element={withLayout(<XmlSubmissionPage />)} />

          {/* Admin */}
          <Route path="/admin/district-notification" element={withLayout(<DistrictNotificationPage />)} />

          {/* Reports */}
          <Route path="/reports/jcrs"           element={withLayout(<JcrsReportsPage />)} />

          {/* Catch-all */}
          <Route path="*"                       element={<Navigate to="/welcome" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="*"              element={<LoginPage />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
