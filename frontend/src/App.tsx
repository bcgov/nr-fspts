import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import Layout from './components/Layout';
import { useAuth } from './context/auth/useAuth';

// Pages
import LandingPage              from './pages/LandingPage';
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
import JcrsReportsPage          from './pages/JcrsReports';

import './App.css';

// Wraps a page in the Carbon UI Shell. Used inline so the route table reads
// like REPT's — `element={withLayout(<Page />)}` — without a per-page edit.
const withLayout = (node: ReactNode) => <Layout>{node}</Layout>;

// ── App ────────────────────────────────────────────────────
export default function App() {
  const { isLoggedIn, isLoading } = useAuth();

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
          {/* Login flow lands here after Amplify exchanges ?code=&state=;
              the LandingPage's IDIR/BCeID buttons go through Cognito and
              return here. Forward straight to Search — Welcome page was
              dropped. */}
          <Route path="/auth/callback"          element={<Navigate to="/search" replace />} />
          <Route path="/"                       element={<Navigate to="/search" replace />} />

          {/* Search */}
          <Route path="/search"                 element={withLayout(<SearchPage />)} />

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
          <Route path="*"                       element={<Navigate to="/search" replace />} />
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
