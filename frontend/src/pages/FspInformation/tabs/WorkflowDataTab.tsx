import {
  Button,
  InlineNotification,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { Add, Edit } from '@carbon/icons-react';
import { type FC, type ReactNode, useEffect, useState } from 'react';

import DdmDecisionEditModal, {
  type DdmDecisionChoice,
  type DdmDecisionSubmitPayload,
} from '@/components/DdmDecisionEditModal';
import ExtensionDecisionEditModal, {
  type ExtensionDecisionSubmitPayload,
} from '@/components/ExtensionDecisionEditModal';
import OtbhEditModal, { type OtbhDialogValue } from '@/components/OtbhEditModal';
import ReviewMilestoneEditModal from '@/components/ReviewMilestoneEditModal';
import { useNotification } from '@/context/notification/useNotification';
import {
  type FspDdmDecision,
  type FspExtensionDecision,
  type FspReviewItem,
  type FspWorkflowRoles,
  type FspWorkflowState,
  getFspWorkflowState,
  submitFspWorkflowAction,
} from '@/services/fspSearch';

interface Props {
  fspId: string;
  /**
   * Parent-supplied monotonic counter bumped after any mutation
   * (Submit, Extend, …). Threaded into the workflow-state fetch
   * deps so the local {@code state.fspStatusCode} flips DFT→SUB
   * after a successful submit, which in turn unlocks every Edit
   * gate this tab derives from {@code state.fspStatusCode} +
   * {@code state.roles} (Review pencils, OTBH Offered, DDM, etc.).
   */
  refreshKey?: number;
  /**
   * Called after any successful workflow mutation (review milestone,
   * DDM decision, DDM reverse, extension decision, OTBH offered/heard).
   * The proc returns {@code FspWorkflowState} not {@code FspInformation},
   * so the parent uses this callback to re-fetch the FSP DTO and bump
   * its own refreshKey — without it the header status pill, amendments
   * dropdown, and sibling tabs would stay stale until manual reload.
   */
  onWorkflowChanged?: () => void;
  /**
   * Read-only role (Reviewer / View-Only). The tab still renders so they
   * can see workflow state, but every action (review pencils, OTBH, DDM
   * decision, extension decision) is suppressed. The backend also
   * rejects their writes (FspAuthorities.WORKFLOW_DECISION), so this is
   * the UI half of that gate.
   */
  readOnly?: boolean;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const isBlank = (value: string | null | undefined): boolean =>
  !value || value.trim() === '';

// Carbon Tag palette aligned with the search-results / header status
// badges so a user's mental colour map for "approved" / "rejected" /
// "submitted" carries straight over from the rest of the app.
type TagType = 'green' | 'blue' | 'gray' | 'red' | 'warm-gray';

const STATUS_TAG_TYPE_BY_CODE: Record<string, TagType> = {
  APP: 'green',
  INE: 'green',
  REJ: 'red',
  SUB: 'blue',
  DFT: 'gray',
  OHS: 'warm-gray',
  EXP: 'warm-gray',
  CAN: 'warm-gray',
  RET: 'warm-gray',
};

const STATUS_LABEL_BY_CODE: Record<string, string> = {
  APP: 'Approved',
  INE: 'Effective',
  REJ: 'Rejected',
  SUB: 'Submitted',
  DFT: 'Clarification Requested',
  OHS: 'Opportunity to be Heard',
  EXP: 'Expired',
  CAN: 'Cancelled',
  RET: 'Retired',
};

const statusTag = (code: string | null | undefined): ReactNode => {
  if (isBlank(code)) return <span>—</span>;
  const upper = (code ?? '').toUpperCase();
  const type = STATUS_TAG_TYPE_BY_CODE[upper] ?? 'gray';
  const label = STATUS_LABEL_BY_CODE[upper] ?? upper;
  return (
    <Tag type={type} size="sm">
      {label}
    </Tag>
  );
};

// Recorded milestones/events show a green "Complete" pill; those without
// a record show a plain em-dash (they don't block approval — see the
// section descriptions).
const completeTag = (ind: string | null | undefined): ReactNode =>
  ind === 'Y' ? (
    <Tag type="green" size="sm">
      Complete
    </Tag>
  ) : (
    <span>—</span>
  );

// "Optional" outline pill shown beside the Review details / OTBH headings.
const optionalTag = (
  <Tag type="outline" size="sm">
    Optional
  </Tag>
);

// Neutral pill shown beside "DDM decision" before any decision is recorded.
const decisionPendingTag = (
  <Tag type="gray" size="sm">
    Decision pending
  </Tag>
);

// DDM "Decided by" field label tracks the decision outcome so it reads
// "Approved by" / "Rejected by" instead of a generic "Decided by".
const decidedByLabel = (code: string | null | undefined): string => {
  switch ((code ?? '').toUpperCase()) {
    case 'APP':
      return 'Approved by';
    case 'REJ':
      return 'Rejected by';
    default:
      return 'Decided by';
  }
};

interface FieldEntry {
  label: string;
  value: ReactNode;
}

const Field: FC<FieldEntry> = ({ label, value }) => (
  <div className="fsp-info__field">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

// ─── Section-level edit gating ──────────────────────────────────────
//
// Mirrors the legacy Fsp700WorkflowForm.java enableXxx() methods. We
// derive these in one place so the per-section Edit buttons can read
// a single boolean rather than re-implementing role + status logic
// at every call site.

// FSPTS Permission Matrix section D (client-confirmed 2026-07-06). The
// review decisions (milestones, comments, Approve, Reject, Offer/Record
// OTBH) belong to Decision Maker + Reviewer — the Administrator is dashed
// out of those cells. Admin keeps request-clarification, extension, and the
// reverse/revert corrections. Backend mirror:
// WorkflowService.assertWorkflowActionAllowed.

// Record review milestone / comments (SAVE_REVIEW) — DM + Reviewer, only
// while Submitted. Administrator excluded.
const enableReviewEdits = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  if ((status ?? '').toUpperCase() !== 'SUB') return false;
  return roles.isDecisionMaker || roles.isReviewer;
};

// Offer Opportunity to be Heard (SAVE_OTBH_OFFERED) — DM + Reviewer, while
// Submitted or Approved. Administrator excluded; the Submitter's matrix Y is
// held pending client clarification and so is not granted here.
const enableOtbhOfferedEdit = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  const s = (status ?? '').toUpperCase();
  if (s !== 'SUB' && s !== 'APP') return false;
  return roles.isDecisionMaker || roles.isReviewer;
};

// Record OTBH heard (SAVE_OTBH_HEARD) — DM + Reviewer, only while OHS.
const enableOtbhHeardEdit = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  if ((status ?? '').toUpperCase() !== 'OHS') return false;
  return roles.isDecisionMaker || roles.isReviewer;
};

// DDM decision dialog (SAVE_DDM_APP / _DFT / _REJ). Which decisions are
// offered depends on the role — see allowedDdmDecisions. On Submitted the
// dialog opens for DM + Reviewer (all three) and for the Administrator
// (Request-clarification only). Administrators retain the post-approval
// date-correction window on APP.
const enableDdmEdit = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => allowedDdmDecisions(status, roles).length > 0;

// The DDM decision choices a given role may take in the current status,
// per matrix D (revision post-[82]). On Submitted: DM + Reviewer get all
// three (Approve / Request-clarification / Reject); the Administrator gets
// Approve + Request-clarification but NOT Reject (still dashed out of Reject).
// On an already-approved plan the Administrator may edit the recorded
// approval's dates (APP).
const allowedDdmDecisions = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): DdmDecisionChoice[] => {
  const s = (status ?? '').toUpperCase();
  if (s === 'SUB') {
    if (roles.isDecisionMaker || roles.isReviewer) return ['APP', 'DFT', 'REJ'];
    if (roles.isAdministrator) return ['APP', 'DFT'];
    return [];
  }
  // Post-approval date correction of the recorded decision stays Admin-only.
  if (s === 'APP') return roles.isAdministrator ? ['APP'] : [];
  return [];
};

// Extension decision (SAVE_EXT_*) — Admin + DM, once an extension row is
// open. Reviewer excluded.
const enableExtensionEdit = (
  status: string | null | undefined,
  extension: FspExtensionDecision,
  roles: FspWorkflowRoles,
): boolean => {
  if (isBlank(extension.statusCode)) return false;
  return roles.isAdministrator || roles.isDecisionMaker;
};

const ddmHasData = (ddm: FspDdmDecision): boolean =>
  !isBlank(ddm.statusCode) ||
  !isBlank(ddm.name) ||
  !isBlank(ddm.decisionDate) ||
  !isBlank(ddm.effectiveDate);

const extensionExists = (
  ext: FspExtensionDecision,
  extensionIds: string | null,
): boolean =>
  !isBlank(ext.statusCode) ||
  !isBlank(ext.extensionId) ||
  !isBlank(extensionIds);

// ─── Tile components ────────────────────────────────────────────────

// StatusSummaryTile was removed — the FSP-level status pill it
// rendered duplicates the canonical one in the page header
// (FspInformation/index.tsx). Its dl block (Amendment / Submission /
// Decision / Effective dates) was also redundant: the header carries
// the amendment picker, and DdmDecisionTile surfaces the same date
// fields below.

// A review milestone counts as "recorded" once it has a completion flag,
// a reviewer, or a comment — drives Edit vs Add on the row action.
const reviewHasRecord = (item: FspReviewItem): boolean =>
  item.completedInd === 'Y' ||
  !isBlank(item.entryUserId) ||
  !isBlank(item.comment);

const ReviewDetailsTile: FC<{
  items: FspReviewItem[];
  canEdit: boolean;
  onEdit: (item: FspReviewItem) => void;
}> = ({ items, canEdit, onEdit }) => (
  <section className="fsp-info__tile fsp-info__tile--full">
    <header className="fsp-info__tile-header">
      <div className="fsp-info__title-group">
        <h2 className="fsp-info__section-title">Review details</h2>
        {optionalTag}
      </div>
    </header>
    <p className="fsp-info__section-desc">
      Optional reviews recorded for this submission. Milestones without a
      record do not block approval.
    </p>
    <div className="bordered-table">
      <TableContainer>
        <Table size="md" useZebraStyles>
          <TableHead>
            <TableRow>
              <TableHeader>Milestone</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Reviewed by</TableHeader>
              <TableHeader>Date</TableHeader>
              <TableHeader>Comment</TableHeader>
              {canEdit && <TableHeader>Actions</TableHeader>}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => {
              const recorded = reviewHasRecord(item);
              return (
                <TableRow key={item.code}>
                  <TableCell>{item.label}</TableCell>
                  <TableCell>{completeTag(item.completedInd)}</TableCell>
                  <TableCell>{dash(item.entryUserId)}</TableCell>
                  <TableCell>{dash(item.entryTimestamp)}</TableCell>
                  <TableCell>{dash(item.comment)}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="fsp-info__row-actions">
                        <Button
                          kind="ghost"
                          size="sm"
                          renderIcon={recorded ? Edit : Add}
                          onClick={() => onEdit(item)}
                        >
                          {recorded ? 'Edit record' : 'Add record'}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  </section>
);

interface OtbhRow {
  key: 'offered' | 'heard';
  label: string;
  completedInd: string | null;
  date: string | null;
  comment: string | null;
}

const OtbhDetailsTile: FC<{
  rows: OtbhRow[];
  rowEditable: (key: OtbhRow['key']) => boolean;
  onEdit: (row: OtbhRow) => void;
}> = ({ rows, rowEditable, onEdit }) => {
  const anyEditable = rows.some((r) => rowEditable(r.key));
  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <div className="fsp-info__title-group">
          <h2 className="fsp-info__section-title">
            Opportunity to be heard (OTBH)
          </h2>
          {optionalTag}
        </div>
      </header>
      <p className="fsp-info__section-desc">
        Recording &ldquo;OTBH offered&rdquo; sets the FSP status to Opportunity
        to Be Heard Sent and locks the plan; &ldquo;OTBH heard&rdquo; returns it
        to Submitted.
      </p>
      <div className="bordered-table">
        <TableContainer>
          <Table size="md" useZebraStyles>
            <TableHead>
              <TableRow>
                <TableHeader>Event</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Date</TableHeader>
                <TableHeader>Comment</TableHeader>
                {anyEditable && <TableHeader>Actions</TableHeader>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const canEditRow = rowEditable(row.key);
                const recorded =
                  row.completedInd === 'Y' ||
                  !isBlank(row.date) ||
                  !isBlank(row.comment);
                return (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{completeTag(row.completedInd)}</TableCell>
                    <TableCell>{dash(row.date)}</TableCell>
                    <TableCell>{dash(row.comment)}</TableCell>
                    {anyEditable && (
                      <TableCell>
                        {canEditRow && (
                          <div className="fsp-info__row-actions">
                            <Button
                              kind="ghost"
                              size="sm"
                              renderIcon={recorded ? Edit : Add}
                              onClick={() => onEdit(row)}
                            >
                              {recorded ? 'Edit record' : 'Add record'}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </section>
  );
};

const DdmDecisionTile: FC<{
  decision: FspDdmDecision;
  canEdit: boolean;
  onEdit: () => void;
}> = ({ decision, canEdit, onEdit }) => {
  const hasData = ddmHasData(decision);
  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <div className="fsp-info__title-group">
          <h2 className="fsp-info__section-title">DDM decision</h2>
          {!isBlank(decision.statusCode)
            ? statusTag(decision.statusCode)
            : decisionPendingTag}
        </div>
        {canEdit && (
          <div className="fsp-info__tile-header-actions">
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={hasData ? Edit : Add}
              onClick={onEdit}
            >
              {hasData ? 'Edit decision' : 'Record decision'}
            </Button>
          </div>
        )}
      </header>
      <p className="fsp-info__section-desc">
        Review the final decision metadata and supporting documents.
      </p>
      {hasData ? (
        <dl className="fsp-info__field-list fsp-info__field-list--emphasis">
          <Field
            label={decidedByLabel(decision.statusCode)}
            value={dash(decision.name)}
          />
          <Field label="Decision date" value={dash(decision.decisionDate)} />
          <Field
            label="Effective date"
            value={dash(decision.effectiveDate)}
          />
          <Field label="Submitted" value={dash(decision.submissionDate)} />
          {!isBlank(decision.comment) && (
            <Field label="Comment" value={dash(decision.comment)} />
          )}
        </dl>
      ) : (
        <p className="fsp-info__placeholder">No decision recorded yet.</p>
      )}
    </section>
  );
};

const ExtensionRequestTile: FC<{
  decision: FspExtensionDecision;
  extensionIds: string | null;
  canEdit: boolean;
  onEdit: () => void;
}> = ({ decision, extensionIds, canEdit, onEdit }) => {
  const hasDecision = !isBlank(decision.statusCode);
  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <div className="fsp-info__title-group">
          <h2 className="fsp-info__section-title">Extension request</h2>
          {hasDecision ? statusTag(decision.statusCode) : decisionPendingTag}
        </div>
        {canEdit && (
          <div className="fsp-info__tile-header-actions">
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={hasDecision ? Edit : Add}
              onClick={onEdit}
            >
              {hasDecision ? 'Edit decision' : 'Record decision'}
            </Button>
          </div>
        )}
      </header>
      <dl className="fsp-info__field-list fsp-info__field-list--emphasis">
        <Field
          label="Extension number"
          value={dash(extensionIds ?? decision.extensionId)}
        />
        <Field
          label="Submission date"
          value={dash(decision.submissionDate)}
        />
        <Field label="Decision by" value={dash(decision.name)} />
        <Field label="Decision date" value={dash(decision.decisionDate)} />
        <Field
          label="Effective date"
          value={dash(decision.effectiveDate)}
        />
        {!isBlank(decision.comment) && (
          <Field label="Comment" value={dash(decision.comment)} />
        )}
      </dl>
    </section>
  );
};

// ─── Page component ─────────────────────────────────────────────────

/**
 * Workflow tab — five-tile layout that replaces the legacy FSP700
 * "Christmas tree". Sections always render so the user sees the
 * complete lifecycle map; per-section Edit affordances are gated by
 * role + FSP status (mirrors Fsp700WorkflowForm.enableXxx() rules from
 * the legacy app). Dialog wiring is added in subsequent slices — the
 * Edit/Add buttons currently log + no-op (and the success path simply
 * re-fetches state).
 */
const WorkflowDataTab: FC<Props> = ({
  fspId,
  refreshKey,
  onWorkflowChanged,
  readOnly = false,
}) => {
  const [state, setState] = useState<FspWorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewEditTarget, setReviewEditTarget] =
    useState<FspReviewItem | null>(null);
  const [otbhEditTarget, setOtbhEditTarget] =
    useState<OtbhDialogValue | null>(null);
  const [ddmModalOpen, setDdmModalOpen] = useState(false);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);
  // Dismissible IDIR-visibility notice at the top of the tab.
  const [bannerVisible, setBannerVisible] = useState(true);
  const { display } = useNotification();

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspWorkflowState(fspId)
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Workflow load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, refreshKey]);

  if (loading && !state) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading workflow…" withOverlay={false} />
      </div>
    );
  }
  if (error) return <p className="fsp-info__error">{error}</p>;
  if (!state) {
    return (
      <p className="fsp-info__placeholder">No workflow data available.</p>
    );
  }

  const { roles, fspStatusCode } = state;
  // Read-only roles see the tab but take no action — force every edit
  // gate off regardless of the backend-projected workflow roles.
  const reviewEditable = !readOnly && enableReviewEdits(fspStatusCode, roles);
  const otbhOfferedEditable = !readOnly && enableOtbhOfferedEdit(fspStatusCode, roles);
  const otbhHeardEditable = !readOnly && enableOtbhHeardEdit(fspStatusCode, roles);
  const ddmEditable = !readOnly && enableDdmEdit(fspStatusCode, roles);
  const extensionEditable =
    !readOnly &&
    enableExtensionEdit(fspStatusCode, state.extensionDecision, roles);
  const extensionIsPresent = extensionExists(
    state.extensionDecision,
    state.extensionIds,
  );

  const otbhRows: OtbhRow[] = [
    {
      key: 'offered',
      label: 'OTBH offered',
      completedInd: state.otbh.offeredDate ? 'Y' : 'N',
      date: state.otbh.offeredDate,
      comment: state.otbh.offeredComment,
    },
    {
      key: 'heard',
      label: 'OTBH heard',
      completedInd: state.otbh.heardDate ? 'Y' : 'N',
      date: state.otbh.heardDate,
      comment: state.otbh.heardComment,
    },
  ];
  const otbhRowEditable = (key: OtbhRow['key']): boolean =>
    key === 'offered' ? otbhOfferedEditable : otbhHeardEditable;

  const handleReviewSave = async (payload: {
    completedInd: 'Y' | 'N';
    comment: string;
  }) => {
    if (!reviewEditTarget) return;
    const updated = await submitFspWorkflowAction(fspId, {
      action: 'SAVE_REVIEW',
      fspAmendmentNumber: state.fspAmendmentNumber ?? undefined,
      milestoneType: reviewEditTarget.code,
      completed: payload.completedInd,
      comments: payload.comment,
    });
    setState(updated);
    onWorkflowChanged?.();
    display({
      kind: 'success',
      title: 'Review milestone updated.',
      subtitle: reviewEditTarget.label,
      timeout: 6000,
    });
  };

  const handleDdmSave = async (payload: DdmDecisionSubmitPayload) => {
    const action =
      payload.decision === 'APP'
        ? 'SAVE_DDM_APP'
        : payload.decision === 'DFT'
          ? 'SAVE_DDM_DFT'
          : 'SAVE_DDM_REJ';
    const updated = await submitFspWorkflowAction(fspId, {
      action,
      fspAmendmentNumber: state.fspAmendmentNumber ?? undefined,
      // Echo the current status so the proc's branching can tell us
      // apart from a Reverse call. completed='Y' is the "make this
      // decision happen" branch (vs 'N' which means "undo").
      fspStatusCode: state.fspStatusCode ?? undefined,
      fspAmendmentCode: state.fspAmendmentCode ?? undefined,
      completed: 'Y',
      submissionDate: payload.submissionDate || undefined,
      decisionDate: payload.decisionDate,
      effectiveDate: payload.effectiveDate,
      comments: payload.comment,
    });
    setState(updated);
    onWorkflowChanged?.();
    display({
      kind: 'success',
      title:
        payload.decision === 'APP'
          ? 'Decision recorded: Approved.'
          : payload.decision === 'DFT'
            ? 'Clarification requested.'
            : 'Decision recorded: Rejected.',
      timeout: 6000,
    });
  };

  const handleExtensionSave = async (
    payload: ExtensionDecisionSubmitPayload,
  ) => {
    const extId = state.extensionDecision.extensionId;
    if (!extId) {
      throw new Error('No extension id on the current FSP — cannot record decision.');
    }
    const action = payload.decision === 'APP' ? 'SAVE_EXT_APP' : 'SAVE_EXT_REJ';
    const updated = await submitFspWorkflowAction(fspId, {
      action,
      fspAmendmentNumber: state.fspAmendmentNumber ?? undefined,
      fspStatusCode: state.fspStatusCode ?? undefined,
      fspAmendmentCode: state.fspAmendmentCode ?? undefined,
      // Legacy proc rejects completed='N' on SAVE_EXT_* with FSP.NO.COMPLETE.IND
      // — extensions have no Reverse path.
      completed: 'Y',
      extensionId: extId,
      submissionDate: payload.submissionDate,
      decisionDate: payload.decisionDate,
      effectiveDate: payload.effectiveDate,
      comments: payload.comment,
    });
    setState(updated);
    onWorkflowChanged?.();
    display({
      kind: 'success',
      title:
        payload.decision === 'APP'
          ? 'Extension approved.'
          : 'Extension rejected.',
      timeout: 6000,
    });
  };

  const handleOtbhSave = async (payload: { date: string; comment: string }) => {
    if (!otbhEditTarget) return;
    const action =
      otbhEditTarget.key === 'offered'
        ? 'SAVE_OTBH_OFFERED'
        : 'SAVE_OTBH_HEARD';
    const updated = await submitFspWorkflowAction(fspId, {
      action,
      fspAmendmentNumber: state.fspAmendmentNumber ?? undefined,
      // Proc rejects with FSP.NO.COMPLETE.IND unless this is 'Y' — both
      // OTBH branches treat the save itself as the completion event.
      completed: 'Y',
      otbhDate: payload.date,
      comments: payload.comment,
    });
    setState(updated);
    onWorkflowChanged?.();
    display({
      kind: 'success',
      title:
        otbhEditTarget.key === 'offered'
          ? 'OTBH Offered recorded.'
          : 'OTBH Heard recorded.',
      timeout: 6000,
    });
  };

  return (
    <>
      {bannerVisible && (
        <InlineNotification
          className="fsp-info__workflow-banner"
          kind="info"
          lowContrast
          title="Information on this tab is visible to all government (IDIR) users, but not to licensees/BCTS. Avoid noting confidential or sensitive information."
          onClose={() => {
            setBannerVisible(false);
            return true;
          }}
        />
      )}
      <div className="fsp-info__tiles-grid">
        <DdmDecisionTile
          decision={state.ddmDecision}
          canEdit={ddmEditable}
          onEdit={() => setDdmModalOpen(true)}
        />

        <ReviewDetailsTile
          items={state.reviewItems}
          canEdit={reviewEditable}
          onEdit={(item) => setReviewEditTarget(item)}
        />

        <OtbhDetailsTile
          rows={otbhRows}
          rowEditable={otbhRowEditable}
          onEdit={(row) =>
            setOtbhEditTarget({
              key: row.key,
              label: row.label,
              date: row.date,
              comment: row.comment,
            })
          }
        />

        {extensionIsPresent && (
        <ExtensionRequestTile
          decision={state.extensionDecision}
          extensionIds={state.extensionIds}
          canEdit={extensionEditable}
          onEdit={() => setExtensionModalOpen(true)}
        />
      )}

      <ReviewMilestoneEditModal
        open={reviewEditTarget != null}
        value={reviewEditTarget}
        onClose={() => setReviewEditTarget(null)}
        onSubmit={handleReviewSave}
      />

      <OtbhEditModal
        open={otbhEditTarget != null}
        value={otbhEditTarget}
        onClose={() => setOtbhEditTarget(null)}
        onSubmit={handleOtbhSave}
      />

      <DdmDecisionEditModal
        open={ddmModalOpen}
        fspId={fspId}
        value={state.ddmDecision}
        currentStatusCode={state.fspStatusCode}
        allowedDecisions={allowedDdmDecisions(fspStatusCode, roles)}
        onClose={() => setDdmModalOpen(false)}
        onSubmit={handleDdmSave}
      />

      <ExtensionDecisionEditModal
        open={extensionModalOpen}
        value={state.extensionDecision}
        extensionLabel={
          state.extensionIds ?? state.extensionDecision.extensionId
        }
        onClose={() => setExtensionModalOpen(false)}
        onSubmit={handleExtensionSave}
      />
      </div>
    </>
  );
};

export default WorkflowDataTab;
