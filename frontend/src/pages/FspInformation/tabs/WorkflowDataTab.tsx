import {
  DataTable,
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
import {type FC, type ReactNode, useEffect, useMemo, useState} from 'react';

import {
  type FspDdmDecision,
  type FspExtensionDecision,
  type FspOtbh,
  type FspReviewItem,
  type FspWorkflowState,
  getFspWorkflowState,
} from '@/services/fspSearch';

interface Props {
  fspId: string;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const isBlank = (value: string | null | undefined): boolean =>
  !value || value.trim() === '';

const hasAny = (...values: (string | null | undefined)[]): boolean =>
  values.some((v) => !isBlank(v));

// Carbon Tag palette aligned with the search-results / header status
// badges so a user's mental colour map for "approved" / "rejected" /
// "submitted" carries straight over from the rest of the app.
type TagType = 'green' | 'blue' | 'gray' | 'red' | 'warm-gray';

// FSP_STATUS_CODE → Tag colour. The DDM decision block surfaces the
// underlying status of the most recent decision row (APP, INE, REJ,
// DFT), so we lean on the same code → tag mapping the FSP header uses.
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

// Human label for the decision-block status pill. The proc only echoes
// the code; "DFT after SUB" is the legacy app's request-for-clarification
// flow, surfaced here with a friendlier name.
const STATUS_LABEL_BY_CODE: Record<string, string> = {
  APP: 'Approved',
  INE: 'Approved',
  REJ: 'Rejected',
  SUB: 'Submitted',
  DFT: 'Clarification Requested',
  OHS: 'OTBH Scheduled',
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

// Review-item "Completed" pill: legacy stored 'Y' / 'N' (or blank). The
// status column collapses these to Completed / Pending so the column
// scans as a single status indicator rather than a raw flag.
const completedTag = (ind: string | null | undefined): ReactNode => {
  if (ind === 'Y') {
    return (
      <Tag type="green" size="sm">
        Completed
      </Tag>
    );
  }
  return (
    <Tag type="gray" size="sm">
      Pending
    </Tag>
  );
};

const reviewItemHasData = (item: FspReviewItem): boolean =>
  item.completedInd === 'Y' ||
  hasAny(item.entryUserId, item.entryTimestamp, item.comment);

const otbhHasData = (otbh: FspOtbh): boolean =>
  hasAny(
    otbh.offeredDate,
    otbh.offeredComment,
    otbh.heardDate,
    otbh.heardComment,
  );

const ddmHasData = (ddm: FspDdmDecision): boolean =>
  hasAny(
    ddm.statusCode,
    ddm.name,
    ddm.submissionDate,
    ddm.decisionDate,
    ddm.effectiveDate,
    ddm.comment,
  );

const extensionHasData = (
  ext: FspExtensionDecision,
  extensionIds: string | null,
): boolean =>
  hasAny(
    ext.statusCode,
    ext.extensionId,
    ext.name,
    ext.submissionDate,
    ext.decisionDate,
    ext.effectiveDate,
    ext.comment,
    extensionIds,
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

/**
 * View-only Workflow tab. Surfaces the FSP_700_WORKFLOW.MAINLINE GET
 * projection: review milestones, OTBH dates, the DDM decision, and the
 * leading extension request. The legacy FSP700 screen rendered every
 * field on a single dense form ("Christmas tree"); this rewrite splits
 * each conceptual block into its own tile and hides blocks that have no
 * data on this FSP/amendment.
 */
const WorkflowDataTab: FC<Props> = ({ fspId }) => {
  const [state, setState] = useState<FspWorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [fspId]);

  const reviewRows = useMemo(() => {
    if (!state) return [];
    return state.reviewItems
      .filter(reviewItemHasData)
      .map((item) => ({
        id: item.code,
        item: item.label,
        statusNode: completedTag(item.completedInd),
        userId: dash(item.entryUserId),
        timestamp: dash(item.entryTimestamp),
        comment: dash(item.comment),
      }));
  }, [state]);

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

  const showReview = reviewRows.length > 0;
  const showOtbh = otbhHasData(state.otbh);
  const showDdm = ddmHasData(state.ddmDecision);
  const showExtension = extensionHasData(
    state.extensionDecision,
    state.extensionIds,
  );

  // Empty-state — no section has anything to show. Better to be explicit
  // than render a tab-panel full of nothing.
  if (!showReview && !showOtbh && !showDdm && !showExtension) {
    return (
      <p className="fsp-info__placeholder">
        No workflow activity has been recorded for this FSP/amendment yet.
      </p>
    );
  }

  return (
    <div className="fsp-info__tiles-grid">
      {showReview && (
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Review Details</h2>
          </header>
          <div className="bordered-table">
            <DataTable
              rows={reviewRows}
              headers={[
                { key: 'item', header: 'Item' },
                { key: 'statusNode', header: 'Status' },
                { key: 'userId', header: 'By' },
                { key: 'timestamp', header: 'Date' },
                { key: 'comment', header: 'Comments' },
              ]}
            >
              {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                <TableContainer>
                  <Table {...getTableProps()} size="md" useZebraStyles>
                    <TableHead>
                      <TableRow>
                        {headers.map((h) => (
                          <TableHeader
                            {...getHeaderProps({ header: h })}
                            key={h.key}
                          >
                            {h.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow {...getRowProps({ row })} key={row.id}>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.id}>
                              {cell.value as ReactNode}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          </div>
        </section>
      )}

      {showDdm && (
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">DDM Decision</h2>
            {statusTag(state.ddmDecision.statusCode)}
          </header>
          <dl className="fsp-info__field-list">
            <Field
              label="Decision Maker"
              value={dash(state.ddmDecision.name)}
            />
            <Field
              label="Submission Date"
              value={dash(state.ddmDecision.submissionDate)}
            />
            <Field
              label="Decision Date"
              value={dash(state.ddmDecision.decisionDate)}
            />
            <Field
              label="Effective Date"
              value={dash(state.ddmDecision.effectiveDate)}
            />
            {!isBlank(state.ddmDecision.comment) && (
              <Field
                label="Comments"
                value={dash(state.ddmDecision.comment)}
              />
            )}
          </dl>
        </section>
      )}

      {showExtension && (
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">Extension Request</h2>
            {statusTag(state.extensionDecision.statusCode)}
          </header>
          <dl className="fsp-info__field-list">
            <Field
              label="Extension ID"
              value={dash(state.extensionDecision.extensionId)}
            />
            <Field
              label="Extension Number(s)"
              value={dash(state.extensionIds)}
            />
            <Field
              label="Submission Date"
              value={dash(state.extensionDecision.submissionDate)}
            />
            <Field
              label="Decision By"
              value={dash(state.extensionDecision.name)}
            />
            <Field
              label="Decision Date"
              value={dash(state.extensionDecision.decisionDate)}
            />
            <Field
              label="Effective Date"
              value={dash(state.extensionDecision.effectiveDate)}
            />
            {!isBlank(state.extensionDecision.comment) && (
              <Field
                label="Comments"
                value={dash(state.extensionDecision.comment)}
              />
            )}
          </dl>
        </section>
      )}

      {showOtbh && (
        <section className="fsp-info__tile fsp-info__tile--full">
          <header className="fsp-info__tile-header">
            <h2 className="fsp-info__section-title">
              Opportunity To Be Heard
            </h2>
          </header>
          <dl className="fsp-info__field-list">
            <Field
              label="Offered Date"
              value={dash(state.otbh.offeredDate)}
            />
            <Field
              label="Offered Comment"
              value={dash(state.otbh.offeredComment)}
            />
            <Field
              label="Heard Date"
              value={dash(state.otbh.heardDate)}
            />
            <Field
              label="Heard Comment"
              value={dash(state.otbh.heardComment)}
            />
          </dl>
        </section>
      )}
    </div>
  );
};

export default WorkflowDataTab;
