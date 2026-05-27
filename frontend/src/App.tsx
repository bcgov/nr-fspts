import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import Layout from './components/Layout';
import { useAuth } from './context/auth/useAuth';

// Pages
import LandingPage              from './pages/LandingPage';
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

// Wraps a page in the Carbon UI Shell. Used inline so the route table reads
// like REPT's — `element={withLayout(<Page />)}` — without a per-page edit.
const withLayout = (node: ReactNode) => <Layout>{node}</Layout>;

// ── App ────────────────────────────────────────────────────
export default function App() {
  const { user, isLoggedIn, isLoading } = useAuth();
  const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || user?.displayName
    || user?.userName
    || '';

  // Show a minimal placeholder during the initial auth bootstrap so a
  // page reload mid-session doesn't briefly render the LandingPage
  // before AuthProvider's useEffect has finished reading the cookie
  // session. After Amplify exchanges any ?code=&state= and AuthProvider
  // hydrates the user, the routing branch below picks up.
  if (isLoading) {
    return <div aria-busy="true" />;
  }

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
          {/* While unauthenticated, every URL falls through to the
              Landing page. Amplify handles ?code=&state= at boot time
              (see main.tsx) so /auth/callback doesn't need a dedicated
              component — the URL is just a momentary landing pad
              before the AuthProvider hydrates and the authenticated
              branch kicks in. */}
          <Route path="*" element={<LandingPage />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
