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
} from '@carbon/react';
import { Modal } from '@/components/Modal';
import { useEffect, useState, type FC } from 'react';

import StatusTag from '@/components/StatusTag/StatusTag';
import { useNotification } from '@/context/notification/useNotification';
import { type FspExtensionSummary, getFspExtensions } from '@/services/fspSearch';

import './extension-summary-modal.scss';

/**
 * Dialog version of the legacy FSP303 "Extension Summary" page. Two
 * sections: an FSP tombstone strip across the top (original effective
 * date, original expiry, current term, current expiry) and a table of
 * every extension request — number, request date, status, decision
 * date, term, dates, and which amendment number the extension is
 * tied to.
 *
 * <p>Lazy-loads the summary the first time it opens for a given fspId;
 * re-fetches when the fspId changes mid-session.
 */
interface Props {
  open: boolean;
  fspId: string | null;
  onClose: () => void;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const HEADERS = [
  { key: 'extensionNumber', header: 'Ext #' },
  { key: 'submissionDate', header: 'Request date' },
  { key: 'status', header: 'Status' },
  { key: 'decisionDate', header: 'Decision date' },
  { key: 'term', header: 'Term' },
  { key: 'planEndDate', header: 'Expiry date' },
  { key: 'planStartDate', header: 'Effective date' },
  { key: 'fspAmendmentNumber', header: 'Amnd # in effect' },
];

const ExtensionSummaryModal: FC<Props> = ({ open, fspId, onClose }) => {
  const { display } = useNotification();
  const [summary, setSummary] = useState<FspExtensionSummary | null>(null);
  const [loading, setLoading] = useState(false);

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

  // Reset the cached summary when the modal closes so the next open
  // shows the loading spinner instead of a stale view.
  useEffect(() => {
    if (!open) setSummary(null);
  }, [open]);

  const tombstone: { label: string; value: string }[] = summary
    ? [
        { label: 'FSP name', value: dash(summary.fspPlanName) },
        { label: 'Effective date', value: dash(summary.originalEffectiveDate) },
        {
          label: 'Original expiry date',
          value: dash(summary.originalExpiryDate),
        },
        {
          label: 'Current term',
          value: `${dash(summary.currentPlanTermYears)} yr ${dash(
            summary.currentPlanTermMonths,
          )} mo`,
        },
        {
          label: 'Current expiry date',
          value: dash(summary.currentExpiryDate),
        },
      ]
    : [];

  const tableRows =
    summary?.extensions.map((e, i) => ({
      id: e.extensionId ?? `row-${i}`,
      extensionNumber: dash(e.extensionNumber),
      submissionDate: dash(e.submissionDate),
      status: dash(e.statusDescription ?? e.statusCode),
      decisionDate: dash(e.decisionDate),
      term: `${dash(e.planTermYears)} yr ${dash(e.planTermMonths)} mo`,
      planEndDate: dash(e.planEndDate),
      planStartDate: dash(e.planStartDate),
      fspAmendmentNumber: dash(e.fspAmendmentNumber),
    })) ?? [];

  return (
    <Modal
      open={open}
      modalHeading={`Extension Summary — FSP ${fspId ?? '—'}`}
      passiveModal
      size="lg"
      className="fsp-extension-summary-modal"
      onRequestClose={onClose}
    >
      <div className="fsp-extension-summary-modal__body">
        {loading && !summary ? (
          <div className="fsp-extension-summary-modal__loading" role="status" aria-live="polite">
            <Loading description="Loading extensions…" withOverlay={false} />
          </div>
        ) : !summary ? (
          <p>FSP not found or you do not have access to it.</p>
        ) : (
          <>
            <section className="fsp-extension-summary-modal__tombstone">
              <dl className="fsp-extension-summary-modal__fields">
                {tombstone.map((f) => (
                  <div key={f.label} className="fsp-extension-summary-modal__field">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <h3 className="fsp-extension-summary-modal__section-title">
                Extensions ({summary.extensions.length})
              </h3>
              {summary.extensions.length === 0 ? (
                <p>No extension requests recorded for this FSP.</p>
              ) : (
                <div className="bordered-table">
                  <DataTable rows={tableRows} headers={HEADERS} isSortable>
                    {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
                      <TableContainer>
                        <Table {...getTableProps()} size="sm" useZebraStyles>
                          <TableHead>
                            <TableRow>
                              {headers.map((h) => (
                                <TableHeader {...getHeaderProps({ header: h })} key={h.key}>
                                  {h.header}
                                </TableHeader>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {r.map((row) => (
                              <TableRow {...getRowProps({ row })} key={row.id}>
                                {row.cells.map((cell) => {
                                  if (cell.info.header === 'status' && cell.value) {
                                    return (
                                      <TableCell key={cell.id}>
                                        <StatusTag status={cell.value as string} />
                                      </TableCell>
                                    );
                                  }
                                  return (
                                    <TableCell key={cell.id}>{cell.value as string}</TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </DataTable>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ExtensionSummaryModal;
