import {BrowserRouter, Navigate, Route, Routes, useLocation} from 'react-router-dom';
import type {FC, ReactNode} from 'react';

import Layout from './components/Layout';
import SessionTimeout from './components/SessionTimeout';
import {useAuth} from './context/auth/useAuth';
import {useOrg} from './context/org/useOrg';
import {defaultRouteForUser, isPathAllowedForUser} from './routes/access';

// Pages
import AuthCallback from './pages/AuthCallback';
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
import CreateFspPage from './pages/CreateFspPage';
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

/** True on the route Keycloak redirects back to after sign-in. */
const isAuthCallback = (): boolean =>
  window.location.pathname.replace(/\/$/, '').endsWith('/authCallback');

// ── App ────────────────────────────────────────────────────
export default function App() {
  const { isLoggedIn, isLoading, user } = useAuth();
  const { needsOrgSelection } = useOrg();

  // Keycloak's sign-in redirect lands here carrying ?code=&state=. Handled
  // ahead of every branch below: the session doesn't exist until this page
  // completes the exchange, so the signed-out branch's Landing catch-all
  // would otherwise swallow the code. It then navigates to `/`, where the
  // signed-in branch picks the user's landing page.
  if (isAuthCallback()) {
    return <AuthCallback />;
  }

  // Show a minimal placeholder during the initial auth bootstrap so a
  // page reload mid-session doesn't briefly render the LandingPage
  // before AuthProvider has finished restoring the stored session.
  if (isLoading) {
    return <div aria-busy="true" />;
  }

  // Authenticated-but-unauthorized: token decoded fine but carries no
  // recognised FSPTS_* role. AuthProvider keeps these users in state on
  // purpose (see its bootstrap comment) so we can render a friendly
  // "no access" landing instead of looping them back through Keycloak.
  // Every URL collapses to /unauthorized in this branch.
  const hasFsptsRole = isLoggedIn && (user?.roles?.length ?? 0) > 0;

  return (
    <BrowserRouter>
      {/* Inactivity guard — mounted for every authenticated state (including
          the no-role and org-select gates) so the warning modal + auto-logout
          apply everywhere a session is live. Renders nothing until it fires. */}
      {isLoggedIn && <SessionTimeout />}
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
          {/* AuthCallback lands here after the code exchange. Default route
              is role-aware — BCeID submitters don't have access to /search
              and would just bounce off the guard if we hard-coded /search
              here. */}
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

          {/* Create FSP — the manual counterpart of Data Submission, for a
              plan started from scratch rather than from a file. The feature
              is a dialog; it gets a route so the nav entry has somewhere to
              land and Back behaves. */}
          <Route path="/fsp/create"             element={guarded(withLayout(<CreateFspPage />))} />

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
              Landing page. (/authCallback is handled above, before
              routing.) */}
          <Route path="*" element={<LandingPage />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
