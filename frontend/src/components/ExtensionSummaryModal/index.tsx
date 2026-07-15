import {
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { ChevronDown, Launch } from '@carbon/icons-react';
import { Modal } from '@/components/Modal';
import { Fragment, useEffect, useState, type FC } from 'react';

import StatusTag from '@/components/StatusTag/StatusTag';
import { useNotification } from '@/context/notification/useNotification';
import {
  fetchFspAttachmentBlob,
  getExtensionAttachments,
  getFspExtensions,
  type ExtensionAttachment,
  type FspExtension,
  type FspExtensionSummary,
} from '@/services/fspSearch';

import './extension-summary-modal.scss';

/**
 * Dialog version of the legacy FSP303 "Extension Summary" page. A
 * tombstone strip across the top (FSP name, effective/original-expiry/
 * current-expiry dates, current term) sits above a table of every
 * extension request. Each row expands to show the request's comment, the
 * plan version in effect on its effective date, and its linked
 * attachments (request letter, DDM decision letter) — the latter fetched
 * lazily the first time a row is opened.
 */
interface Props {
  open: boolean;
  fspId: string | null;
  onClose: () => void;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Proc dates arrive as "YYYY-MM-DD" (convert_to_char default). Reformat to
// "Mon D, YYYY"; anything unparseable falls through as the dash/raw value.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const fmtDate = (value: string | null | undefined): string => {
  const v = dash(value);
  if (v === '—') return v;
  const m = DATE_RE.exec(v.trim());
  if (!m) return v;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

// "5 years, 0 months" — mirrors the tombstone strip and the screenshots.
const fmtTerm = (
  years: string | null | undefined,
  months: string | null | undefined,
): string => {
  const y = years?.trim();
  const mo = months?.trim();
  if (!y && !mo) return '—';
  return `${y || '0'} years, ${mo || '0'} months`;
};

// Plan version the extension applies to. Amendment 0 is the original plan.
const versionLabel = (value: string | null | undefined): string => {
  if (value == null || value.trim() === '') return '—';
  return Number(value) === 0 ? 'Original' : value.trim();
};

// The SUB (Submitted) status has no DDM decision yet — surface the same
// "Awaiting DDM Decision" state the legacy summary showed. Other statuses
// are self-explanatory from the Status pill, so no extra chip.
const pendingLabel = (statusCode: string | null): string | null =>
  (statusCode ?? '').toUpperCase() === 'SUB' ? 'Awaiting DDM Decision' : null;

/** Lazily-loaded per-extension detail (attachments) shown when a row expands. */
const ExtensionDetail: FC<{ fspId: string; extension: FspExtension }> = ({
  fspId,
  extension,
}) => {
  const { display } = useNotification();
  const extensionId = extension.extensionId ?? '';
  const [attachments, setAttachments] = useState<ExtensionAttachment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    if (!extensionId) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getExtensionAttachments(fspId, extensionId)
      .then((rows) => {
        if (!cancelled) setAttachments(rows);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, extensionId]);

  // Open an attachment inline in a new tab (auth header means we can't
  // just point an <a> at the download URL). Mirrors the Attachments tab.
  const view = async (attachmentId: string | null, name: string | null) => {
    if (!attachmentId || viewingId) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      display({
        kind: 'error',
        title: 'Pop-up blocked',
        subtitle: 'Allow pop-ups for this site to view attachments.',
        timeout: 7000,
      });
      return;
    }
    setViewingId(attachmentId);
    try {
      const blob = await fetchFspAttachmentBlob(fspId, attachmentId, name);
      popup.location.href = URL.createObjectURL(blob);
    } catch (e) {
      popup.close();
      display({
        kind: 'error',
        title: 'Could not open attachment',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 7000,
      });
    } finally {
      setViewingId(null);
    }
  };

  const pending = pendingLabel(extension.statusCode);

  return (
    <div className="ext-summary__detail">
      {pending && <span className="ext-summary__pending-chip">{pending}</span>}

      <div className="ext-summary__detail-block">
        <p className="ext-summary__detail-label">Comment</p>
        <p className="ext-summary__detail-value">{dash(extension.statusComment)}</p>
      </div>

      <div className="ext-summary__detail-block">
        <p className="ext-summary__detail-label">
          Version in effect on extension effective date
        </p>
        <p className="ext-summary__detail-value">
          {versionLabel(extension.fspAmendmentNumber)}
        </p>
      </div>

      <div className="ext-summary__detail-block">
        <p className="ext-summary__detail-label">Attachments</p>
        {loading ? (
          <Loading small withOverlay={false} description="Loading attachments…" />
        ) : !attachments || attachments.length === 0 ? (
          <p className="ext-summary__detail-value">No attachments.</p>
        ) : (
          <ul className="ext-summary__attachments">
            {attachments.map((a) => (
              <li key={a.attachmentId ?? a.attachmentName}>
                <button
                  type="button"
                  className="ext-summary__attachment-link"
                  onClick={() => void view(a.attachmentId, a.attachmentName)}
                  disabled={viewingId === a.attachmentId}
                >
                  <span>{dash(a.attachmentName)}</span>
                  <Launch size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const ExtensionSummaryModal: FC<Props> = ({ open, fspId, onClose }) => {
  const { display } = useNotification();
  const [summary, setSummary] = useState<FspExtensionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !fspId) return;
    let cancelled = false;
    setLoading(true);
    getFspExtensions(fspId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        if (cancelled) return;
        display({
          kind: 'error',
          title: 'Unable to load extensions',
          subtitle: e instanceof Error ? e.message : 'Unknown error',
          timeout: 7000,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fspId, display]);

  // Reset cached state on close so the next open shows the spinner and no
  // stale expansion.
  useEffect(() => {
    if (!open) {
      setSummary(null);
      setExpanded(new Set());
    }
  }, [open]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tombstone: { label: string; value: string }[] = summary
    ? [
        { label: 'FSP name', value: dash(summary.fspPlanName) },
        { label: 'Effective date', value: fmtDate(summary.originalEffectiveDate) },
        { label: 'Original Expiry', value: fmtDate(summary.originalExpiryDate) },
        { label: 'Current Expiry', value: fmtDate(summary.currentExpiryDate) },
        {
          label: 'Current term',
          value: fmtTerm(summary.currentPlanTermYears, summary.currentPlanTermMonths),
        },
      ]
    : [];

  const extensions = summary?.extensions ?? [];

  return (
    <Modal
      open={open}
      modalHeading={`Extension summary: FSP ${fspId ?? '—'}`}
      passiveModal
      size="lg"
      className="fsp-extension-summary-modal"
      onRequestClose={onClose}
    >
      <div className="ext-summary">
        {loading && !summary ? (
          <div className="ext-summary__loading" role="status" aria-live="polite">
            <Loading description="Loading extensions…" withOverlay={false} />
          </div>
        ) : !summary ? (
          <p>FSP not found or you do not have access to it.</p>
        ) : (
          <>
            <section className="ext-summary__card">
              <dl className="ext-summary__tombstone">
                {tombstone.map((f) => (
                  <div key={f.label} className="ext-summary__tombstone-field">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="ext-summary__card ext-summary__card--table">
              <h3 className="ext-summary__section-title">
                Extensions ({extensions.length})
              </h3>
              {extensions.length === 0 ? (
                <p className="ext-summary__empty">
                  No extension requests recorded for this FSP.
                </p>
              ) : (
                <TableContainer>
                  <Table size="md" useZebraStyles={false}>
                    <TableHead>
                      <TableRow>
                        <TableHeader className="ext-summary__expand-col">
                          <span className="cds--visually-hidden">Expand</span>
                        </TableHeader>
                        <TableHeader>Extension</TableHeader>
                        <TableHeader>Request date</TableHeader>
                        <TableHeader>Status</TableHeader>
                        <TableHeader>Decision date</TableHeader>
                        <TableHeader>Effective date</TableHeader>
                        <TableHeader>Expiry date</TableHeader>
                        <TableHeader>Term</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {extensions.map((e, i) => {
                        const id = e.extensionId ?? `row-${i}`;
                        const isOpen = expanded.has(id);
                        const statusLabel = e.statusDescription ?? e.statusCode;
                        return (
                          <Fragment key={id}>
                            <TableRow>
                              <TableCell className="ext-summary__expand-col">
                                <button
                                  type="button"
                                  className={`ext-summary__expand-btn${
                                    isOpen ? ' ext-summary__expand-btn--open' : ''
                                  }`}
                                  aria-expanded={isOpen}
                                  aria-label={
                                    isOpen
                                      ? `Collapse extension ${dash(e.extensionNumber)}`
                                      : `Expand extension ${dash(e.extensionNumber)}`
                                  }
                                  onClick={() => toggle(id)}
                                >
                                  <ChevronDown size={16} />
                                </button>
                              </TableCell>
                              <TableCell>{dash(e.extensionNumber)}</TableCell>
                              <TableCell>{fmtDate(e.submissionDate)}</TableCell>
                              <TableCell>
                                {statusLabel ? (
                                  <StatusTag status={statusLabel} />
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell>{fmtDate(e.decisionDate)}</TableCell>
                              <TableCell>{fmtDate(e.planStartDate)}</TableCell>
                              <TableCell>{fmtDate(e.planEndDate)}</TableCell>
                              <TableCell>
                                {fmtTerm(e.planTermYears, e.planTermMonths)}
                              </TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow className="ext-summary__detail-row">
                                <TableCell colSpan={8}>
                                  {fspId && (
                                    <ExtensionDetail fspId={fspId} extension={e} />
                                  )}
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ExtensionSummaryModal;
