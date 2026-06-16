import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import type {ReactNode} from 'react';

import Layout from './components/Layout';
import {useAuth} from './context/auth/useAuth';
import {useOrg} from './context/org/useOrg';

// Pages
import LandingPage from './pages/LandingPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import SearchPage from './pages/SearchPage';
import StandardsSearchPage from './pages/StandardsSearchPage';
import InboxPage from './pages/InboxPage';
import FspInformationPage from './pages/FspInformation';
import HistoryPage from './pages/HistoryPage';
import DistrictNotificationPage from './pages/DistrictNotificationPage';
import OrgSelectionPage from './pages/OrgSelectionPage';
import SubmissionHistoryPage from './pages/SubmissionHistoryPage';
import XmlSubmissionPage from './pages/XmlSubmissionPage';
import JcrsReportsPage from './pages/JcrsReports';

import './App.css';

// Wraps a page in the Carbon UI Shell. Used inline so the route table reads
// like REPT's — `element={withLayout(<Page />)}` — without a per-page edit.
const withLayout = (node: ReactNode) => <Layout>{node}</Layout>;

// ── App ────────────────────────────────────────────────────
export default function App() {
  const { isLoggedIn, isLoading, user } = useAuth();
  const { needsOrgSelection } = useOrg();

  // Show a minimal placeholder during the initial auth bootstrap so a
  // page reload mid-session doesn't briefly render the LandingPage
  // before AuthProvider's useEffect has finished reading the cookie
  // session. After Amplify exchanges any ?code=&state= and AuthProvider
  // hydrates the user, the routing branch below picks up.
  if (isLoading) {
    return <div aria-busy="true" />;
  }

  // Authenticated-but-unauthorized: token decoded fine but carries no
  // recognised FSPTS_* role. AuthProvider keeps these users in state on
  // purpose (see its `refreshUserState` comment) so we can render a
  // friendly "no access" landing instead of looping them back through
  // Cognito. Every URL collapses to /unauthorized in this branch.
  const hasFsptsRole = isLoggedIn && (user?.roles?.length ?? 0) > 0;

  return (
    <BrowserRouter>
      {isLoggedIn && !hasFsptsRole ? (
        <Routes>
          <Route path="*" element={<UnauthorizedPage />} />
        </Routes>
      ) : isLoggedIn && needsOrgSelection ? (
        // BCeID submitter with multiple client orgs and no choice yet —
        // collapse every URL to the picker so downstream requests have
        // an unambiguous org context. Layout intentionally omitted so
        // the SideNav doesn't tempt the user to navigate around the gate.
        <Routes>
          <Route path="/org-select" element={<OrgSelectionPage />} />
          <Route path="*" element={<Navigate to="/org-select" replace />} />
        </Routes>
      ) : isLoggedIn ? (
        <Routes>
          {/* Login flow lands here after Amplify exchanges ?code=&state=;
              the LandingPage's IDIR/BCeID buttons go through Cognito and
              return here. Forward straight to Search — Welcome page was
              dropped. */}
          <Route path="/auth/callback"          element={<Navigate to="/search" replace />} />
          <Route path="/"                       element={<Navigate to="/search" replace />} />
          {/* The picker is reachable post-selection too in case the user
              wants to switch orgs without signing out. Rendered without
              Layout so the forest-image split-screen treatment matches
              the Landing/Unauthorized look. */}
          <Route path="/org-select"             element={<OrgSelectionPage />} />

          {/* Search */}
          <Route path="/search"                 element={withLayout(<SearchPage />)} />

          {/* Stocking Standards Search (FSP501) */}
          <Route path="/standards-search"       element={withLayout(<StandardsSearchPage />)} />

          {/* Inbox */}
          <Route path="/inbox"                  element={withLayout(<InboxPage />)} />

          {/* FSP — Attachments / Standards / FDU / Identified Areas /
              Workflow used to be top-level routes; they're now mounted
              as Carbon Tabs inside FspInformationPage so the navigation
              stays inside one consolidated screen. Amend / Extension /
              Replace remain separate destinations (the legacy treats
              them as dedicated sub-pages, not tabs). */}
          <Route path="/fsp/information"        element={withLayout(<FspInformationPage />)} />
          {/* Amendment + Replacement Description, New Extension Request,
              and Extension Summary are all dialogs now — no standalone
              routes. */}
          <Route path="/fsp/history"            element={withLayout(<HistoryPage />)} />

          {/* Data Submission — accepts both XML and GeoJSON. URL kept
              generic so it survives format additions. */}
          <Route path="/data-submission"        element={withLayout(<XmlSubmissionPage />)} />
          {/* BCeID-only read view: every FSP for the active forest-client.
              Routed for everyone so an IDIR support user can also view it
              when impersonating; the SideNav only surfaces it for BCeID. */}
          <Route path="/submission-history"     element={withLayout(<SubmissionHistoryPage />)} />
          {/* Backwards-compat redirect for any stored /data-submission/xml link */}
          <Route path="/data-submission/xml"    element={<Navigate to="/data-submission" replace />} />

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
