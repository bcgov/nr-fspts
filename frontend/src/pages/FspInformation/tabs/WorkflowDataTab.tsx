import {
  Button,
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

const completedTag = (ind: string | null | undefined): ReactNode =>
  ind === 'Y' ? (
    <Tag type="green" size="sm">
      Completed
    </Tag>
  ) : (
    <Tag type="gray" size="sm">
      Pending
    </Tag>
  );

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

const enableReviewEdits = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  const s = (status ?? '').toUpperCase();
  // Legacy: disabled in DFT/OHS-already-sent; enabled only when SUB.
  // OHS technically appears in the role check below but is short-circuited
  // by the early-out at the top of enableReviewDetails().
  if (s !== 'SUB') return false;
  return roles.isReviewer || roles.isDecisionMaker || roles.isAdministrator;
};

const enableOtbhOfferedEdit = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  const s = (status ?? '').toUpperCase();
  if (s === 'DFT' || s === 'OHS') return false;
  if (!roles.isDecisionMaker && !roles.isAdministrator) return false;
  // SUB for everyone; after that only Administrators (canUpdateApproved).
  // Decision Makers get Submitted only.
  return s === 'SUB' || canUpdateApproved(roles);
};

const enableOtbhHeardEdit = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  const s = (status ?? '').toUpperCase();
  if (s !== 'OHS') return false;
  return roles.isDecisionMaker || roles.isAdministrator;
};

const enableDdmEdit = (
  status: string | null | undefined,
  roles: FspWorkflowRoles,
): boolean => {
  const s = (status ?? '').toUpperCase();
  if (!roles.isDecisionMaker && !roles.isAdministrator) return false;
  // Administrators may record a decision while Submitted and amend it
  // after approval (APP). Decision Makers act only during the review
  // phase — Submitted — and never re-open a decided plan.
  if (roles.isAdministrator) return s === 'SUB' || s === 'APP';
  return s === 'SUB';
};

const enableExtensionEdit = (
  status: string | null | undefined,
  extension: FspExtensionDecision,
  roles: FspWorkflowRoles,
): boolean => {
  if (isBlank(extension.statusCode)) return false;
  // Extension decisions act on already-approved (In-Effect) plans, which
  // is outside the Decision Maker's review-phase scope — Administrator
  // only.
  return roles.isAdministrator;
};

// Admin-only: edits to a decision (or OTBH) after the review phase.
// Decision Makers act only while a plan is Submitted, never after, so
// they no longer get the post-approval (INE) window they once did.
const canUpdateApproved = (roles: FspWorkflowRoles): boolean =>
  roles.isAdministrator;

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

const ReviewDetailsTile: FC<{
  items: FspReviewItem[];
  canEdit: boolean;
  onEdit: (item: FspReviewItem) => void;
}> = ({ items, canEdit, onEdit }) => (
  <section className="fsp-info__tile fsp-info__tile--full">
    <header className="fsp-info__tile-header">
      <h2 className="fsp-info__section-title">Review details</h2>
    </header>
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
              {canEdit && (
                <TableHeader style={{ width: '4rem' }} aria-label="Actions" />
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.code}>
                <TableCell>{item.label}</TableCell>
                <TableCell>{completedTag(item.completedInd)}</TableCell>
                <TableCell>{dash(item.entryUserId)}</TableCell>
                <TableCell>{dash(item.entryTimestamp)}</TableCell>
                <TableCell>{dash(item.comment)}</TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Edit}
                      iconDescription="Edit"
                      hasIconOnly
                      onClick={() => onEdit(item)}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
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
        <h2 className="fsp-info__section-title">
          Opportunity To Be Heard
        </h2>
      </header>
      <div className="bordered-table">
        <TableContainer>
          <Table size="md" useZebraStyles>
            <TableHead>
              <TableRow>
                <TableHeader>Event</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Date</TableHeader>
                <TableHeader>Comment</TableHeader>
                {anyEditable && (
                  <TableHeader style={{ width: '4rem' }} aria-label="Actions" />
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const canEditRow = rowEditable(row.key);
                return (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{completedTag(row.completedInd)}</TableCell>
                    <TableCell>{dash(row.date)}</TableCell>
                    <TableCell>{dash(row.comment)}</TableCell>
                    {anyEditable && (
                      <TableCell>
                        {canEditRow && (
                          <Button
                            kind="ghost"
                            size="sm"
                            renderIcon={Edit}
                            iconDescription="Edit"
                            hasIconOnly
                            onClick={() => onEdit(row)}
                          />
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
        {/* Status pill removed — the FSP-level status it surfaces is
            already the canonical header pill in FspInformation. */}
        <h2 className="fsp-info__section-title">DDM decision</h2>
      </header>
      {canEdit && (
        <div className="fsp-info__tab-actions">
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={hasData ? Edit : Add}
            onClick={onEdit}
          >
            {hasData ? 'Edit Decision' : 'Record Decision'}
          </Button>
        </div>
      )}
      {hasData ? (
        <dl className="fsp-info__field-list">
          <Field label="Decided by" value={dash(decision.name)} />
          <Field
            label="Submission date"
            value={dash(decision.submissionDate)}
          />
          <Field label="Decision date" value={dash(decision.decisionDate)} />
          <Field
            label="Effective date"
            value={dash(decision.effectiveDate)}
          />
          <Field label="Comment" value={dash(decision.comment)} />
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
        <h2 className="fsp-info__section-title">Extension request</h2>
        {hasDecision && statusTag(decision.statusCode)}
      </header>
      {canEdit && (
        <div className="fsp-info__tab-actions">
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={hasDecision ? Edit : Add}
            onClick={onEdit}
          >
            {hasDecision ? 'Edit Decision' : 'Record Decision'}
          </Button>
        </div>
      )}
      <dl className="fsp-info__field-list">
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
        <Field label="Comment" value={dash(decision.comment)} />
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
    <div className="fsp-info__tiles-grid">
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

      <DdmDecisionTile
        decision={state.ddmDecision}
        canEdit={ddmEditable}
        onEdit={() => setDdmModalOpen(true)}
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
        value={state.ddmDecision}
        currentStatusCode={state.fspStatusCode}
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
  );
};

export default WorkflowDataTab;
