import {BrowserRouter, Navigate, Route, Routes, useLocation} from 'react-router-dom';
import type {FC, ReactNode} from 'react';

import Layout from './components/Layout';
import {useAuth} from './context/auth/useAuth';
import {useOrg} from './context/org/useOrg';
import {defaultRouteForUser, isPathAllowedForUser} from './routes/access';

// Pages
import LandingPage from './pages/LandingPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import ForbiddenPage from './pages/ForbiddenPage';
import SearchPage from './pages/SearchPage';
import StandardsSearchPage from './pages/StandardsSearchPage';
import InboxPage from './pages/InboxPage';
import FspInformationPage from './pages/FspInformation';
import FspMapPage from './pages/FspMap';
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

/**
 * Per-role route guard. Wraps any authenticated route — if the user's
 * role doesn't permit the current pathname, swap the page for
 * {@link ForbiddenPage} (still inside the Carbon UI Shell so the
 * SideNav lets them click to a page they DO have access to). Sits
 * inside the BrowserRouter so it can read the resolved pathname via
 * useLocation; an HOC that wrapped the routes array externally
 * wouldn't have that hook context.
 */
const RoleGuarded: FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  if (!isPathAllowedForUser(user, location.pathname)) {
    return <Layout><ForbiddenPage /></Layout>;
  }
  return <>{children}</>;
};

const guarded = (node: ReactNode) => <RoleGuarded>{node}</RoleGuarded>;

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
              return here. Default route is role-aware — BCeID submitters
              don't have access to /search and would just bounce off the
              guard if we hard-coded /search here. */}
          <Route path="/auth/callback"          element={<Navigate to={defaultRouteForUser(user)} replace />} />
          <Route path="/"                       element={<Navigate to={defaultRouteForUser(user)} replace />} />
          {/* The picker is reachable post-selection too in case the user
              wants to switch orgs without signing out. Rendered without
              Layout so the forest-image split-screen treatment matches
              the Landing/Unauthorized look. */}
          <Route path="/org-select"             element={<OrgSelectionPage />} />

          {/* Search */}
          <Route path="/search"                 element={guarded(withLayout(<SearchPage />))} />

          {/* Stocking Standards Search (FSP501) */}
          <Route path="/standards-search"       element={guarded(withLayout(<StandardsSearchPage />))} />

          {/* Inbox */}
          <Route path="/inbox"                  element={guarded(withLayout(<InboxPage />))} />

          {/* FSP — Attachments / Standards / FDU /
              Workflow used to be top-level routes; they're now mounted
              as Carbon Tabs inside FspInformationPage so the navigation
              stays inside one consolidated screen. Amend / Extension /
              Replace remain separate destinations (the legacy treats
              them as dedicated sub-pages, not tabs). */}
          <Route path="/fsp/information"        element={guarded(withLayout(<FspInformationPage />))} />
          {/* Full-screen FDU map, opened in a new tab from the Map tab's
              per-row "Map view" links. Chrome-free (no Layout) — it's a
              focused map popup, not a navigational page. */}
          <Route path="/fsp/map"                element={guarded(<FspMapPage />)} />
          {/* Amendment + Replacement Description, New Extension Request,
              and Extension Summary are all dialogs now — no standalone
              routes. */}
          <Route path="/fsp/history"            element={guarded(withLayout(<HistoryPage />))} />

          {/* Data Submission — accepts both XML and GeoJSON. URL kept
              generic so it survives format additions. */}
          <Route path="/data-submission"        element={guarded(withLayout(<XmlSubmissionPage />))} />
          {/* BCeID-only read view: every FSP for the active forest-client.
              Routed for everyone so an IDIR support user can also view it
              when impersonating; the SideNav only surfaces it for BCeID. */}
          <Route path="/submission-history"     element={guarded(withLayout(<SubmissionHistoryPage />))} />
          {/* Backwards-compat redirect for any stored /data-submission/xml link */}
          <Route path="/data-submission/xml"    element={<Navigate to="/data-submission" replace />} />

          {/* Admin */}
          <Route path="/admin/district-notification" element={guarded(withLayout(<DistrictNotificationPage />))} />

          {/* Reports */}
          <Route path="/reports/jcrs"           element={guarded(withLayout(<JcrsReportsPage />))} />

          {/* Catch-all — route to whatever the user's role lands on by
              default rather than blindly to /search. */}
          <Route path="*"                       element={<Navigate to={defaultRouteForUser(user)} replace />} />
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
