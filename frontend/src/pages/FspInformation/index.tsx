import {Breadcrumb, BreadcrumbItem, Button, Column, Grid, Link, Loading, Select, SelectItem, Tab, TabList, TabPanel, TabPanels, Tabs,} from '@carbon/react';
import {
  CalendarAdd,
  DocumentAdd,
  DocumentAttachment,
  Flow,
  Map,
  Renew,
  RecentlyViewed,
  SendAlt,
  TableOfContents,
  TrashCan,
} from '@carbon/icons-react';
import { StandardsSearchIcon } from '@/components/Layout/navIcons';
import { StatusTag } from '@/components/StatusTag/StatusTag';
import {type FC, useEffect, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import AmendmentDescriptionModal from '@/components/AmendmentDescriptionModal';
import AmendmentReplacementSummaryModal from '@/components/AmendmentReplacementSummaryModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import ExtensionRequestModal from '@/components/ExtensionRequestModal';
import ExtensionSummaryModal from '@/components/ExtensionSummaryModal';
import SubmitFspModal from '@/components/SubmitFspModal';
import {useAuth} from '@/context/auth/useAuth';
import {useNotification} from '@/context/notification/useNotification';
import {
  canActionWorkflow,
  canEditFsp,
  canEditFspContent,
  canSeeWorkflowTab,
  defaultRouteForUser,
} from '@/routes/access';
import {type CodeOption, type FspExtension, type FspInformation, deleteFsp, getFspAmendmentNumbers, getFspById, getFspExtensions,} from '@/services/fspSearch';

import AttachmentsTab from './tabs/AttachmentsTab';
import InformationTab from './tabs/InformationTab';
import MapTab from './tabs/MapTab';
import StockingStandardsTab from './tabs/StockingStandardsTab';
import WorkflowTab from './tabs/WorkflowTab';
import WorkflowDataTab from './tabs/WorkflowDataTab';

import './fsp-info.scss';

// Adapter so the custom Standards-Search nav icon (fixed 20px) renders at
// Carbon's tab-icon size. Carbon calls renderIcon with `{ size: 16 }`; the
// nav icon ignores `size`, so map it onto width/height. Keeps the Stocking
// standards tab icon identical to the side-nav Standards Search item.
const StockingStandardsTabIcon = ({ size = 16 }: { size?: number }) => (
  <StandardsSearchIcon width={size} height={size} />
);

// fspExtensionStat is a bare status code — a single char on the FSP300
// read path (e.g. 'S') — so map it to the human label the shared
// StatusTag expects, and drive its colour, in the header type-summary
// card. Both single-letter and 3-letter forms are covered.
const EXTENSION_STAT_LABEL: Record<string, string> = {
  S: 'Submitted',
  A: 'Approved',
  I: 'In effect',
  R: 'Rejected',
  D: 'Draft',
  SUB: 'Submitted',
  APP: 'Approved',
  INE: 'In effect',
  REJ: 'Rejected',
  DFT: 'Draft',
  OHS: 'Opportunity to be Heard',
  EXP: 'Expired',
  CAN: 'Cancelled',
  RET: 'Retired',
};

const FspInformationPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { display } = useNotification();
  const { user } = useAuth();
  const isAdmin = !!user?.roles?.includes('FSPTS_ADMINISTRATOR');
  // The Submit / Amend / Replace / Extend / Delete header actions are
  // FSP-content mutations — only content-editing roles (Administrator /
  // Submitter) get them. Decision Makers and read-only roles do not,
  // regardless of FSP status.
  const canModify = canEditFspContent(user);

  const fspId = searchParams.get('fspId') ?? '';
  const amendmentNumber = searchParams.get('amendmentNumber') ?? '';

  const [fsp, setFsp] = useState<FspInformation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Amendments-dropdown options for this FSP. Loaded once per fspId
  // change; switching amendments only re-fetches the FSP record.
  const [amendments, setAmendments] = useState<CodeOption[]>([]);
  // Monotonic counter the parent bumps after a state-mutating action
  // (Submit, Extend, etc.). Every child tab that fetches its own
  // server data threads this through its useEffect deps so it
  // refetches when the parent signals — without it, tabs like
  // WorkflowDataTab keep showing pre-submit status because they're
  // keyed on [fspId] alone.
  const [refreshKey, setRefreshKey] = useState(0);
  // Controlled tab index so cross-tab links (e.g. the "Attachments" links
  // in the Workflow tab's decision sub-headings) can switch tabs.
  // Order mirrors the <Tab> list below: 0 Information, 1 Stocking, 2 FDU/Map,
  // 3 Attachments, 4 History, 5 Workflow.
  const [selectedTab, setSelectedTab] = useState(0);
  /**
   * Swap the FSP DTO in place AND bump refreshKey so the tabs
   * re-fetch their own slices. Use after any mutation whose effects
   * the tabs would otherwise miss (submit, extension create,
   * delete-and-replace amendment, etc.).
   */
  const refreshAfterMutation = (updated: FspInformation) => {
    setFsp(updated);
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    if (!fspId) {
      setError('No FSP selected. Pick one from the Search page.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspById(fspId, amendmentNumber || undefined)
      .then((data) => {
        if (!cancelled) setFsp(data);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Failed to load FSP.';
        setError(message);
        display({
          kind: 'error',
          title: 'Unable to load FSP',
          subtitle: message,
          timeout: 7000,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, amendmentNumber, display]);

  // Resolve the real extension status for the header pill. Runs whenever
  // the FSP reports an extension exists (stat other than blank/'N'); we
  // pick the highest-numbered extension as "the latest" and let its
  // status code/description drive the pill. Cleared when no extension.
  const extensionStatFlag = (fsp?.fspExtensionStat ?? '').toUpperCase();
  const hasExtension = extensionStatFlag !== '' && extensionStatFlag !== 'N';
  // The fspExtensionStat flag is scoped to the amendment currently in view
  // (e.g. 'S' = a submitted extension exists on THIS version). The
  // /extensions endpoint, however, returns every extension across all
  // amendments of the plan, so we must pick the one belonging to the
  // current amendment — otherwise a superseded amendment's cancelled
  // extension (e.g. one auto-cancelled by a later replacement) can outrank
  // the fresh submitted request and drive the pill to "Cancelled".
  const pillAmendmentNumber = fsp?.fspAmendmentNumber ?? amendmentNumber ?? '0';
  useEffect(() => {
    if (!fspId || !hasExtension) {
      setLatestExtension(null);
      return;
    }
    let cancelled = false;
    getFspExtensions(fspId)
      .then((summary) => {
        if (cancelled) return;
        const forThisAmendment = summary.extensions.filter(
          (e) =>
            Number(e.fspAmendmentNumber ?? 0) === Number(pillAmendmentNumber),
        );
        const latest = forThisAmendment.reduce<FspExtension | null>(
          (best, e) =>
            best === null ||
            Number(e.extensionNumber ?? 0) >= Number(best.extensionNumber ?? 0)
              ? e
              : best,
          null,
        );
        setLatestExtension(latest);
      })
      .catch(() => {
        if (!cancelled) setLatestExtension(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, hasExtension, pillAmendmentNumber, refreshKey]);

  // Amendment-numbers fetch refreshes when the user switches FSPs OR
  // when the parent signals a mutation that may have bumped revision_count
  // (Submit, Extend, etc.). Threading refreshKey here keeps the dropdown
  // honest after those flows.
  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    getFspAmendmentNumbers(fspId)
      .then((rows) => {
        if (!cancelled) setAmendments(rows);
      })
      .catch(() => {
        // Non-fatal: just leaves the dropdown empty/uncontrolled.
        if (!cancelled) setAmendments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, refreshKey]);

  const handleAmendmentChange = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) {
      params.set('amendmentNumber', next);
    } else {
      params.delete('amendmentNumber');
    }
    setSearchParams(params);
  };

  // The active amendment for the dropdown's value. Falls back to the
  // proc-resolved amendment from the FSP record when the URL didn't
  // pin one (matches what the user sees in the meta block).
  const selectedAmendment =
    amendmentNumber || fsp?.fspAmendmentNumber || '';

  // Width fallback for browsers without `field-sizing: content`. Use the
  // displayed text length of the selected option (e.g. "Original" = 8,
  // "1" = 1) + a chevron allowance, expressed in `ch` units. Six ch
  // gives the chevron enough room not to clip the option text.
  const selectedLabel =
    amendments.find((a) => a.code === selectedAmendment)?.description ??
    selectedAmendment ??
    '';
  const amendmentSelectWidth = `${Math.max(2, selectedLabel.length) + 6}ch`;

  // With only the original version there's nothing to switch between, so the
  // picker renders as static "Version: Original" text instead of a dropdown.
  const hasMultipleVersions = amendments.length > 1;
  const soleVersionLabel =
    amendments.find((a) => a.code === selectedAmendment)?.description ??
    amendments[0]?.description ??
    'Original';

  const statusDesc = fsp?.fspStatusDesc?.trim() ?? '';
  // Delete is gated by the legacy status CODE (not the human description)
  // since the description varies by locale / future renames. FSPTS
  // Permission Matrix section C (client-confirmed 2026-07-06) allows Delete
  // on a Draft (DFT) OR a Rejected (REJ) plan — a rejected FSP is terminal,
  // so removing it is the only lifecycle action left. The proc accepts both;
  // role scoping (Admin / Submitter-own-org) is enforced by canModify + the
  // backend access guard.
  const deletableStatus =
    fsp?.fspStatusCode === 'DFT' || fsp?.fspStatusCode === 'REJ';
  const canDelete = canModify && deletableStatus;
  // Amendment vs base-FSP detection drives both the button label and
  // the post-delete routing. Amendment number > 0 = an amendment; 0 /
  // missing = the original FSP. Treat NaN as 0 so a bad URL doesn't
  // accidentally render "Delete Amendment".
  const parsedAmendmentNumber = Number.parseInt(
    fsp?.fspAmendmentNumber ?? amendmentNumber ?? '0',
    10,
  );
  const isAmendment =
    Number.isFinite(parsedAmendmentNumber) && parsedAmendmentNumber > 0;
  // Submit transitions a draft to Submitted via the SUBMIT proc
  // action — matches the legacy Fsp300InformationForm.isSubmitEnabled
  // which also gated on DFT status (the proc itself accepts SUB→DFT
  // and other transitions but Submit-from-the-header is draft-only).
  const canSubmit = canModify && fsp?.fspStatusCode === 'DFT';
  // Extending an FSP only makes sense once it's been approved (FSP302's
  // legacy isExtendFSPEnabled gates on APP / INE statuses). Replicating
  // that here so the button doesn't show for drafts or rejections.
  const isApprovedOrInEffect =
    fsp?.fspStatusCode === 'APP' || fsp?.fspStatusCode === 'INE';
  // A submitted (open) extension request is awaiting a DDM decision, so no
  // new amendment / extension / replacement may be started until it's
  // resolved — otherwise two lifecycle changes would be in flight against
  // the same plan. fspExtensionStat === 'S' is the FSP300 read's flag for
  // "an extension in SUB status exists" (see EXTENSION_STAT_LABEL). Mirrors
  // the backend guard in ActionCodeContextValidator for XML uploads.
  const hasOpenExtension = extensionStatFlag === 'S';
  // An unapproved amendment/replacement is still in flight (DFT/SUB/OHS).
  // While one exists, NO new lifecycle change may be started — amend,
  // extend or replace — even when the user has navigated back to the
  // original (Approved) version, which would otherwise pass the
  // isApprovedOrInEffect gate. fspUnapprovedAmendsInd is a plan-level flag
  // from the FSP300 read, so it stays 'Y' on every version until the open
  // amendment is resolved.
  const hasUnapprovedAmend = fsp?.fspUnapprovedAmendsInd === 'Y';
  const canExtend =
    canModify && isApprovedOrInEffect && !hasOpenExtension && !hasUnapprovedAmend;
  const canAmend =
    canModify && isApprovedOrInEffect && !hasUnapprovedAmend && !hasOpenExtension;
  const canReplace =
    canModify && isApprovedOrInEffect && !hasOpenExtension && !hasUnapprovedAmend;
  // Workflow tab is hidden for Submitter-only and View-Only roles —
  // nothing on it (DDM decision / OTBH / extension review) applies to
  // them. History (read-only audit) stays visible regardless.
  const showWorkflowTab = canSeeWorkflowTab(user);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [confirmAmendOpen, setConfirmAmendOpen] = useState(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [extensionDialogOpen, setExtensionDialogOpen] = useState(false);
  // Read-only summary dialogs opened from the header type-summary card.
  const [descriptionSummaryOpen, setDescriptionSummaryOpen] = useState(false);
  const [extensionSummaryOpen, setExtensionSummaryOpen] = useState(false);
  // Latest extension for this FSP, fetched to drive the header pill. The
  // FSP300 read only returns a 3-state flag ('N'/'S'/'Y') that can't tell
  // Approved from Rejected, so we pull the extension summary and use the
  // most-recent extension's real status code/description instead.
  const [latestExtension, setLatestExtension] = useState<FspExtension | null>(
    null,
  );
  // True while the Information tab's Plan details are being edited — locks
  // the page-level action buttons so a mid-edit mutation can't clobber the
  // in-flight changes.
  const [infoEditing, setInfoEditing] = useState(false);

  // ConfirmationModal manages its own busy + error-toast lifecycle:
  // it awaits the promise, closes on success, and shows an "Action
  // failed" toast on throw. We post the success toast and navigate
  // after the modal resolves. Routing branches on what got deleted:
  //   - Amendment (amendment number > 0): the parent FSP still exists,
  //     so refresh the page against amendment 0 (the next-most-recent
  //     visible amendment). The amendments dropdown re-fetches inside
  //     the existing useEffect when searchParams change.
  //   - Full FSP (amendment 0 or missing): nothing left to view —
  //     fall back to the user's role-appropriate landing page (BCeID
  //     submitters → /submission-history; everyone else → /search).
  const handleConfirmDelete = async () => {
    if (!fsp?.fspId) return;
    const fspIdSnapshot = fsp.fspId;
    const wasAmendment = isAmendment;
    await deleteFsp(fspIdSnapshot, fsp.fspAmendmentNumber ?? amendmentNumber);
    display({
      kind: 'success',
      title: wasAmendment
        ? `Amendment ${parsedAmendmentNumber} deleted from FSP ${fspIdSnapshot}`
        : `FSP ${fspIdSnapshot} deleted`,
      timeout: 6000,
    });
    if (wasAmendment) {
      // Stay on the FSP — drop the amendment query-param so the URL points
      // at the most recent remaining amendment.
      const params = new URLSearchParams(searchParams);
      params.delete('amendmentNumber');
      params.set('fspId', fspIdSnapshot);
      setSearchParams(params, { replace: true });
      // Force a full refresh of the pane. The URL change alone doesn't cut
      // it: it leaves the header fields stale when the deleted amendment was
      // being viewed as the latest (no amendmentNumber param to change), and
      // it never bumps refreshKey, so the amendments dropdown, extension
      // pill, and every tab keep showing the deleted amendment's data.
      // Re-read the FSP against the latest remaining amendment and pipe it
      // through refreshAfterMutation (setFsp + refreshKey bump).
      try {
        const fresh = await getFspById(fspIdSnapshot);
        refreshAfterMutation(fresh);
      } catch {
        // Re-read failed — at least bump refreshKey so the dropdown/tabs
        // refetch; the header will reflect the URL-driven fetch.
        setRefreshKey((k) => k + 1);
      }
    } else {
      navigate(defaultRouteForUser(user));
    }
  };

  // Amend / Replace open AmendmentDescriptionModal in 'create-amend'
  // or 'create-replace' mode — the modal chains AMEND/REPLACE then SAVE
  // internally. On success it returns the new amendment as an
  // FspInformation DTO; we pin the URL to its new amendmentNumber so
  // the rest of the page re-fetches against the new draft and the
  // amendments dropdown picks up the assignment.
  const navigateToNewAmendment = (updated: FspInformation) => {
    refreshAfterMutation(updated);
    if (updated.fspAmendmentNumber) {
      const params = new URLSearchParams(searchParams);
      params.set('amendmentNumber', updated.fspAmendmentNumber);
      setSearchParams(params);
    }
  };

  // Submit is handled by the SubmitFspModal — it runs the proc-side
  // preflight (validate_fsp) when it opens and renders a checklist if
  // any FSP.* issues come back, only enabling the Submit button once
  // the preflight is clean. The page just provides the open/close
  // toggle and the post-submit detail refresh.
  const planName = fsp?.fspPlanName?.trim() || '—';
  // The proc returns 200 + all-null fields when the requested FSP id
  // can't be resolved in forest_stewardship_plan (warning-only error
  // path, not a fatal HTTP error). Treat that as "not found" on the
  // client side so the user sees an explicit empty state instead of a
  // silently-blank header + tabs.
  const fspMissing = !loading && !!fsp && !fsp.fspId && !fsp.fspPlanName;

  // Header type-summary card: each column only appears when the current
  // version actually is that type. fspAmendmentCode is AMD (amendment)
  // or RPL (replacement) — mutually exclusive; fspExtensionStat is 'N'
  // (or blank) when there's no extension, otherwise a status code.
  const amendmentCode = (fsp?.fspAmendmentCode ?? '').toUpperCase();
  const showAmendment = amendmentCode === 'AMD';
  const showReplacement = amendmentCode === 'RPL';
  const extensionStat = (fsp?.fspExtensionStat ?? '').toUpperCase();
  const showExtension = extensionStat !== '' && extensionStat !== 'N';
  const showTypeSummary =
    !fspMissing && (showAmendment || showReplacement || showExtension);
  // Prefer the real status from the latest extension (statusDescription is
  // already a human label; statusCode falls through the map). Only fall back
  // to the ambiguous FSP300 flag while the summary is still loading — that
  // flag can't distinguish Approved from Rejected (both map to 'Y').
  const extensionStatusLabel =
    latestExtension?.statusDescription ??
    (latestExtension?.statusCode
      ? (EXTENSION_STAT_LABEL[latestExtension.statusCode.toUpperCase()] ??
        latestExtension.statusCode)
      : (EXTENSION_STAT_LABEL[extensionStat] ?? ''));

  return (
    <Grid fullWidth className="default-grid fsp-info-grid">
      <Column sm={4} md={8} lg={16}>
        {/* Breadcrumb steers per role — BCeID submitters land at
            /submission-history (the FSP Search page is gated off for
            them), everyone else lands at /search. Carbon shows a trailing
            slash by default, giving the "FSP Search /" look. */}
        <Breadcrumb noTrailingSlash={false} className="fsp-info__breadcrumb">
          <BreadcrumbItem
            href={defaultRouteForUser(user)}
            onClick={(e) => {
              e.preventDefault();
              navigate(defaultRouteForUser(user));
            }}
          >
            {defaultRouteForUser(user) === '/submission-history'
              ? 'Submission history'
              : 'FSP Search'}
          </BreadcrumbItem>
        </Breadcrumb>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <header className="fsp-info__header">
          <div className="fsp-info__header-title">
            <h1>FSP {fsp?.fspId ?? fspId}</h1>
            {statusDesc && <StatusTag status={statusDesc} />}
            {(canExtend || canAmend || canReplace || canSubmit || canDelete) && (
              <div className="fsp-info__header-actions">
                {canAmend && fsp?.fspId && (
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={DocumentAdd}
                    disabled={infoEditing}
                    onClick={() => setConfirmAmendOpen(true)}
                  >
                    Amend FSP
                  </Button>
                )}
                {canExtend && fsp?.fspId && (
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={CalendarAdd}
                    disabled={infoEditing}
                    onClick={() => setExtensionDialogOpen(true)}
                  >
                    Extend FSP
                  </Button>
                )}
                {canReplace && fsp?.fspId && (
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Renew}
                    disabled={infoEditing}
                    onClick={() => setConfirmReplaceOpen(true)}
                  >
                    Replace FSP
                  </Button>
                )}
                {canSubmit && fsp?.fspId && (
                  <Button
                    kind="primary"
                    size="sm"
                    renderIcon={SendAlt}
                    disabled={infoEditing}
                    onClick={() => setConfirmSubmitOpen(true)}
                  >
                    Submit FSP
                  </Button>
                )}
                {canDelete && (
                  <Button
                    kind="danger--tertiary"
                    size="sm"
                    renderIcon={TrashCan}
                    disabled={infoEditing}
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    {isAmendment ? 'Delete amendment' : 'Delete FSP'}
                  </Button>
                )}
              </div>
            )}
          </div>
          {!fspMissing && (
            <p className="fsp-info__subtitle">Check and manage this FSP</p>
          )}
          {!fspMissing && (
            <dl className="fsp-info__meta">
              {hasMultipleVersions ? (
                <div className="fsp-info__meta-item fsp-info__meta-item--select">
                  <strong>Version</strong>
                  <Select
                    id="fsp-amendment-picker"
                    labelText=""
                    hideLabel
                    size="sm"
                    style={{ width: amendmentSelectWidth }}
                    value={selectedAmendment}
                    onChange={(e) => handleAmendmentChange(e.target.value)}
                    disabled={infoEditing}
                  >
                    {amendments.map((a) => (
                      <SelectItem key={a.code} value={a.code} text={a.description} />
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="fsp-info__meta-item">
                  <span>
                    <strong>Version</strong>: {soleVersionLabel}
                  </span>
                </div>
              )}
            </dl>
          )}
        </header>
      </Column>

      {showTypeSummary && (
        <Column sm={4} md={8} lg={16}>
          <div className="fsp-info__type-summary">
            {showAmendment && (
              <div className="fsp-info__type-summary-item">
                <div className="fsp-info__type-summary-head">
                  <span className="fsp-info__type-summary-label">Amendment</span>
                </div>
                <Link
                  as="button"
                  type="button"
                  onClick={() => setDescriptionSummaryOpen(true)}
                >
                  View amendment description
                </Link>
              </div>
            )}
            {showReplacement && (
              <div className="fsp-info__type-summary-item">
                <div className="fsp-info__type-summary-head">
                  <span className="fsp-info__type-summary-label">Replacement</span>
                </div>
                <Link
                  as="button"
                  type="button"
                  onClick={() => setDescriptionSummaryOpen(true)}
                >
                  View replacement request
                </Link>
              </div>
            )}
            {showExtension && (
              <div className="fsp-info__type-summary-item">
                <div className="fsp-info__type-summary-head">
                  <span className="fsp-info__type-summary-label">Extension</span>
                  {extensionStatusLabel && (
                    <StatusTag status={extensionStatusLabel} />
                  )}
                </div>
                <Link
                  as="button"
                  type="button"
                  onClick={() => setExtensionSummaryOpen(true)}
                >
                  View extension summary
                </Link>
              </div>
            )}
          </div>
        </Column>
      )}

      <Column sm={4} md={8} lg={16}>
        {loading && !fsp ? (
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading FSP…" withOverlay={false} />
          </div>
        ) : error && !fsp ? (
          <p className="fsp-info__error" role="alert">
            {error}
          </p>
        ) : fspMissing ? (
          <div className="fsp-info__placeholder" role="status">
            <p>
              FSP <strong>{fspId}</strong> was not found.
            </p>
            <p>
              It may not exist in this environment, or you may not have access to
              it. Try a fresh search to see the FSPs available to your account.
            </p>
          </div>
        ) : (
          <div
            className={`fsp-info__content${
              loading ? ' fsp-info__content--loading' : ''
            }`}
          >
            {loading && (
              <div
                className="fsp-info__content-overlay"
                role="status"
                aria-live="polite"
              >
                <Loading description="Loading FSP…" withOverlay={false} />
              </div>
            )}
          {/* Carbon's <Tabs> only renders a context provider (no DOM),
              so a className on it is dropped. Wrap it in a real div so the
              full-bleed gray pane styling can target the panel. */}
          <div className="fsp-info__page-tabs">
          <Tabs
            selectedIndex={selectedTab}
            onChange={({ selectedIndex }) => setSelectedTab(selectedIndex)}
          >
            <TabList aria-label="FSP sections" contained>
              <Tab renderIcon={TableOfContents}>Information</Tab>
              <Tab renderIcon={StockingStandardsTabIcon}>Stocking standards</Tab>
              <Tab renderIcon={Map}>FDU / Map</Tab>
              <Tab renderIcon={DocumentAttachment}>Attachments</Tab>
              <Tab renderIcon={RecentlyViewed}>History</Tab>
              {showWorkflowTab && <Tab renderIcon={Flow}>Workflow</Tab>}
            </TabList>
            <TabPanels>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <InformationTab
                    fsp={fsp}
                    onSaved={setFsp}
                    onEditingChange={setInfoEditing}
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <StockingStandardsTab
                    fspId={fspId}
                    amendmentNumber={
                      fsp?.fspAmendmentNumber || amendmentNumber || ''
                    }
                    refreshKey={refreshKey}
                    fspStatusCode={fsp?.fspStatusCode}
                    isAdmin={isAdmin}
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <MapTab
                    fspId={fspId}
                    amendmentNumber={
                      fsp?.fspAmendmentNumber || amendmentNumber || '0'
                    }
                    variant="fdu"
                    fspStatusCode={fsp?.fspStatusCode}
                    isAdmin={isAdmin}
                    readOnly={!canEditFsp(user, fsp?.fspStatusCode)}
                    refreshKey={refreshKey}
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <AttachmentsTab
                    fspId={fspId}
                    refreshKey={refreshKey}
                    fspStatusCode={fsp?.fspStatusCode}
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <WorkflowTab fspId={fspId} refreshKey={refreshKey} />
                </div>
              </TabPanel>
              {showWorkflowTab && (
                <TabPanel>
                  <div className="fsp-info__tab-panel">
                    <WorkflowDataTab
                      fspId={fspId}
                      amendmentNumber={
                        fsp?.fspAmendmentNumber || amendmentNumber || ''
                      }
                      refreshKey={refreshKey}
                      onOpenAttachments={() => setSelectedTab(3)}
                      // Workflow read-only is decided by workflow-action
                      // capability, NOT content-edit: Decision Makers can
                      // act here (status-gated) but can't edit content.
                      readOnly={!canActionWorkflow(user)}
                      // Any workflow action (review milestone, DDM
                      // decision, OTBH offered/heard, extension decision,
                      // DDM reverse) mutates the FSP's status server-side.
                      // The proc returns FspWorkflowState only, so re-fetch
                      // the FSP DTO and pipe it through refreshAfterMutation
                      // — same shape as ExtensionRequestModal.onCreated.
                      onWorkflowChanged={() => {
                        if (fsp?.fspId) {
                          void getFspById(
                            fsp.fspId,
                            fsp.fspAmendmentNumber ?? undefined,
                          ).then(refreshAfterMutation);
                        }
                      }}
                    />
                  </div>
                </TabPanel>
              )}
            </TabPanels>
          </Tabs>
          </div>
          </div>
        )}
      </Column>
      {/* FSP-action + summary dialogs only make sense for a loaded FSP.
          Gating them on fsp?.fspId also keeps their (always-in-DOM, even
          when closed) bodies from leaking content — e.g. the Extension
          Summary modal's "FSP not found" text — onto the not-found page. */}
      {fsp?.fspId && (
        <>
      <ConfirmationModal
        open={confirmDeleteOpen}
        heading={isAmendment ? 'Delete this amendment?' : 'Delete this draft FSP?'}
        confirmLabel="Delete"
        danger
        errorTitle={isAmendment ? 'Failed to delete amendment' : 'Failed to delete FSP'}
        onConfirm={handleConfirmDelete}
        onClose={() => setConfirmDeleteOpen(false)}
      >
        {isAmendment ? (
          <>
            <p>
              This permanently removes amendment{' '}
              <strong>{parsedAmendmentNumber}</strong> on FSP{' '}
              <strong>{fsp?.fspId}</strong> ({planName}) and all of its
              attachments, standards, and FDUs. The prior approved
              amendment is left in place — you'll be returned to it
              after the delete.
            </p>
            <p>This cannot be undone.</p>
          </>
        ) : (
          <>
            <p>
              This permanently removes FSP <strong>{fsp?.fspId}</strong> ({planName})
              and all its child records — attachments, standards, FDUs.
            </p>
            <p>This cannot be undone.</p>
          </>
        )}
      </ConfirmationModal>
      <SubmitFspModal
        open={confirmSubmitOpen}
        fsp={fsp}
        fallbackAmendmentNumber={amendmentNumber || null}
        onClose={() => setConfirmSubmitOpen(false)}
        onSubmitted={refreshAfterMutation}
        onOpenAttachments={() => setSelectedTab(3)}
      />
      <AmendmentDescriptionModal
        open={confirmAmendOpen}
        fsp={fsp}
        heading="Amend FSP"
        mode="create-amend"
        onClose={() => setConfirmAmendOpen(false)}
        onSaved={navigateToNewAmendment}
      />
      <AmendmentDescriptionModal
        open={confirmReplaceOpen}
        fsp={fsp}
        heading="Replace FSP"
        mode="create-replace"
        onClose={() => setConfirmReplaceOpen(false)}
        onSaved={navigateToNewAmendment}
      />
      <AmendmentReplacementSummaryModal
        open={descriptionSummaryOpen}
        fsp={fsp}
        onClose={() => setDescriptionSummaryOpen(false)}
      />
      <ExtensionSummaryModal
        open={extensionSummaryOpen}
        fspId={fsp?.fspId ?? fspId}
        onClose={() => setExtensionSummaryOpen(false)}
      />
      <ExtensionRequestModal
        open={extensionDialogOpen}
        fsp={fsp}
        onClose={() => setExtensionDialogOpen(false)}
        // Refresh FSP detail so the Information tab's Related Forms
        // tile flips "Extension Summary" → button (fspExtensionStat
        // moves off 'N'). Also re-fetch amendments + every data-driven
        // tab via the refreshKey bump in refreshAfterMutation.
        onCreated={() => {
          if (fsp?.fspId) {
            void getFspById(fsp.fspId, fsp.fspAmendmentNumber ?? undefined)
              .then(refreshAfterMutation);
          }
        }}
      />
        </>
      )}
    </Grid>
  );
};

export default FspInformationPage;
