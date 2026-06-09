import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionableNotification,
  Button,
  Column,
  FileUploader,
  Grid,
  InlineLoading,
  InlineNotification,
  Stack,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { Upload } from '@carbon/react/icons';
import { useNavigate } from 'react-router-dom';

import { useNotification } from '@/context/notification/useNotification';
import type { FspInformation } from '@/services/fspSearch';
import {
  type SubmissionOutcome,
  type SubmissionPreview,
  type SubmissionValidationError,
  type SubmissionValidationResult,
  submitSubmission,
  validateSubmission,
} from '@/services/fspSubmissions';
import './XmlSubmissionPage.scss';

type ViewState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'validated'; result: SubmissionValidationResult }
  | { kind: 'submitting' }
  | { kind: 'submission'; outcome: SubmissionOutcome };

const MAX_BYTES = 50 * 1024 * 1024;

export default function XmlSubmissionPage() {
  const { display } = useNotification();
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [view, setView] = useState<ViewState>({ kind: 'idle' });
  const [resetKey, setResetKey] = useState(0);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const validateSize = (file: File): string | null => {
    if (file.size > MAX_BYTES) {
      return `File exceeds the 50 MB upload cap (${(file.size / 1_048_576).toFixed(1)} MB)`;
    }
    return null;
  };

  // Carbon's FileUploader.onChange signature varies between major versions
  // — same shim used elsewhere on this page.
  const filesFromCarbon = (
    event: React.SyntheticEvent<HTMLElement>,
    data?: { addedFiles?: Array<{ file: File }> },
  ): File[] => {
    if (data?.addedFiles?.length) {
      return data.addedFiles.map((f) => f.file).filter(Boolean);
    }
    const input = event.currentTarget as unknown as HTMLInputElement;
    if (input?.files?.length) return Array.from(input.files);
    const target = event.target as unknown as HTMLInputElement;
    if (target?.files?.length) return Array.from(target.files);
    return [];
  };

  const onXmlChange = (
    event: React.SyntheticEvent<HTMLElement>,
    data?: { addedFiles?: Array<{ file: File }> },
  ) => {
    const file = filesFromCarbon(event, data)[0] ?? null;
    if (file) {
      const sizeError = validateSize(file);
      if (sizeError) {
        display({ kind: 'error', title: 'File too large', subtitle: sizeError, timeout: 6000 });
        setXmlFile(null);
        return;
      }
    }
    setXmlFile(file);
  };

  const onXmlDelete = () => {
    setXmlFile(null);
    setView({ kind: 'idle' });
  };

  const onAttachmentsChange = (
    event: React.SyntheticEvent<HTMLElement>,
    data?: { addedFiles?: Array<{ file: File }> },
  ) => {
    const list = filesFromCarbon(event, data);
    const oversize = list.find((f) => validateSize(f));
    if (oversize) {
      const reason = validateSize(oversize);
      display({
        kind: 'error',
        title: 'Attachment too large',
        subtitle: reason ?? `${oversize.name} exceeds the 50 MB cap`,
        timeout: 6000,
      });
      setAttachments([]);
      return;
    }
    setAttachments(list);
  };

  const onClear = () => {
    setXmlFile(null);
    setAttachments([]);
    setView({ kind: 'idle' });
    setResetKey((k) => k + 1);
  };

  // Auto-validate whenever a new XML file is picked. The user doesn't
  // have to click anything — the preview lights up as soon as the
  // backend returns.
  useEffect(() => {
    if (!xmlFile || xmlFile.size === 0) return;
    let cancelled = false;
    setView({ kind: 'validating' });
    validateSubmission(xmlFile)
      .then((result) => {
        if (cancelled) return;
        setView({ kind: 'validated', result });
        // Scroll the preview into view so the user notices the new
        // content below the uploader.
        setTimeout(() => {
          previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      })
      .catch((err) => {
        if (cancelled) return;
        setView({ kind: 'idle' });
        display({
          kind: 'error',
          title: 'Validation request failed',
          subtitle: err instanceof Error ? err.message : 'Unknown error',
          timeout: 6000,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [xmlFile, display]);

  const handleSubmit = async () => {
    if (!xmlFile || xmlFile.size === 0) {
      display({
        kind: 'error',
        title: 'No file selected',
        subtitle: 'Pick an XML file before submitting.',
        timeout: 6000,
      });
      return;
    }
    setView({ kind: 'submitting' });
    try {
      const outcome = await submitSubmission(xmlFile, attachments);
      setView({ kind: 'submission', outcome });
      if (outcome.kind === 'created') {
        // Reset the picker + form state so the page is ready for the
        // next submission. The success banner at the top of the page
        // is the persistent confirmation; the toast is supplementary.
        setXmlFile(null);
        setAttachments([]);
        setResetKey((k) => k + 1);
        display({
          kind: 'success',
          title: 'Submission accepted',
          subtitle: `FSP ${outcome.saved.fspId ?? ''} saved.`,
          timeout: 6000,
        });
      } else if (outcome.kind === 'error') {
        display({
          kind: 'error',
          title: 'Submission failed',
          subtitle: outcome.message,
          timeout: 6000,
        });
      }
    } catch (err) {
      setView({ kind: 'idle' });
      display({
        kind: 'error',
        title: 'Submission failed',
        subtitle: err instanceof Error ? err.message : 'Unknown error',
        timeout: 6000,
      });
    }
  };

  const stateBanner = useMemo(() => renderStateBanner(view, xmlFile), [view, xmlFile]);
  const preview = derivePreview(view);
  const canSubmit =
    view.kind === 'validated' && view.result.valid && xmlFile != null;
  const submitting = view.kind === 'submitting';
  const validating = view.kind === 'validating';

  const successOutcome =
    view.kind === 'submission' && view.outcome.kind === 'created' ? view.outcome : null;

  return (
    <Grid fullWidth className="default-grid fsp-submit-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-submit__header">
          <h1>Data Submission</h1>
          <p>
            Upload an FSP submission file in XML or GeoJSON format to preview and submit it.
          </p>
        </div>
      </Column>

      {successOutcome && (
        <Column sm={4} md={8} lg={16}>
          <SuccessBanner saved={successOutcome.saved} />
        </Column>
      )}

      <Column sm={4} md={8} lg={16}>
        <section className="fsp-submit__panel">
          <header className="fsp-submit__panel-header">
            <h2>Upload Submission File</h2>
          </header>
          <div className="fsp-submit__panel-body">
            <FileUploader
              key={`xml-${resetKey}`}
              labelTitle="Submission file"
              labelDescription={
                'Required. Accepted formats: .xml (bare <fsp:fspSubmission> or ESF-wrapped) or .json / .geojson (FSP GeoJSON FeatureCollection). Max 50 MB.'
              }
              buttonLabel="Browse files"
              accept={['.xml', '.json', '.geojson']}
              multiple={false}
              filenameStatus="edit"
              onChange={onXmlChange}
              onDelete={onXmlDelete}
            />
          </div>
        </section>
      </Column>

      {stateBanner && (
        <Column sm={4} md={8} lg={16}>
          {stateBanner}
        </Column>
      )}

      {view.kind === 'validated' && !view.result.valid && view.result.errors.length > 0 && (
        <Column sm={4} md={8} lg={16}>
          <section className="fsp-submit__panel">
            <header className="fsp-submit__panel-header">
              <h2>Validation Issues</h2>
            </header>
            <div className="fsp-submit__panel-body">
              <ErrorTable errors={view.result.errors} />
            </div>
          </section>
        </Column>
      )}

      {preview && (
        <Column sm={4} md={8} lg={16}>
          <div ref={previewRef}>
            <PreviewSections preview={preview} attachments={attachments} />
          </div>
        </Column>
      )}

      <Column sm={4} md={8} lg={16}>
        <section className="fsp-submit__panel">
          <header className="fsp-submit__panel-header">
            <h2>Attachments</h2>
          </header>
          <div className="fsp-submit__panel-body">
            <FileUploader
              key={`att-${resetKey}`}
              labelTitle="Attached files"
              labelDescription="Optional. Multiple files allowed. Max 50 MB per file."
              buttonLabel="Add files"
              multiple
              filenameStatus="edit"
              onChange={onAttachmentsChange}
              onDelete={() => setAttachments([])}
            />
            <AttachmentSummary
              attachments={attachments}
              expected={preview?.metadata?.attachmentCount ?? null}
            />
          </div>
        </section>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <div className="fsp-submit__actions">
          {validating && (
            <div className="fsp-submit__busy">
              <InlineLoading description="Validating…" status="active" />
            </div>
          )}
          {submitting && (
            <div className="fsp-submit__busy">
              <InlineLoading description="Submitting…" status="active" />
            </div>
          )}
          <Button kind="ghost" onClick={onClear} disabled={submitting}>
            Clear
          </Button>
          <Button
            kind="primary"
            renderIcon={Upload}
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
          >
            Submit
          </Button>
        </div>
      </Column>

      {view.kind === 'submission' && view.outcome.kind !== 'created' && (
        <Column sm={4} md={8} lg={16}>
          {renderSubmissionOutcome(view.outcome)}
        </Column>
      )}
    </Grid>
  );
}

// ── State banner ──────────────────────────────────────────────────

function renderStateBanner(view: ViewState, _xmlFile: File | null): React.ReactNode {
  // Idle (no file yet) renders nothing — the uploader itself is the
  // call-to-action; an extra "no file uploaded" banner is noise.
  if (view.kind === 'idle') return null;
  if (view.kind === 'validating') {
    return (
      <InlineNotification
        kind="info"
        lowContrast
        hideCloseButton
        title="Validating submission…"
        subtitle="Schema, geometry, and envelope checks are running."
      />
    );
  }
  if (view.kind === 'validated') {
    if (view.result.valid) {
      return (
        <InlineNotification
          kind="success"
          lowContrast
          hideCloseButton
          title="XML is valid."
          subtitle="Review the preview below and click Submit to persist."
        />
      );
    }
    return (
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title={`${view.result.errors.length} validation issue${
          view.result.errors.length === 1 ? '' : 's'
        } found.`}
        subtitle="Fix the XML and re-upload. Submit is disabled until validation passes."
      />
    );
  }
  return null;
}

// ── Preview sections ──────────────────────────────────────────────

function derivePreview(view: ViewState): SubmissionPreview | null {
  if (view.kind === 'validated') return view.result.preview;
  if (view.kind === 'submission' && view.outcome.kind === 'invalid') {
    return view.outcome.result.preview;
  }
  return null;
}

const dash = (v: string | number | null | undefined): string =>
  v == null || v === '' ? '—' : String(v);

const yesNo = (v: boolean | null | undefined): string => {
  if (v == null) return '—';
  return v ? 'Yes' : 'No';
};

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`fsp-submit__field${wide ? ' fsp-submit__field--wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="fsp-submit__panel">
      <header className="fsp-submit__panel-header">
        <h2>{title}</h2>
      </header>
      <div className="fsp-submit__panel-body">{children}</div>
    </section>
  );
}

function PreviewSections({
  preview,
  attachments,
}: {
  preview: SubmissionPreview | null;
  attachments: File[];
}) {
  if (!preview) return null;

  return (
    <Stack gap={6}>
      <Panel title="Submission Metadata">
        <dl className="fsp-submit__fields">
          <Field label="Contact Name" value={dash(preview.metadata?.contactName)} />
          <Field label="Telephone Number" value={dash(preview.metadata?.telephoneNumber)} />
          <Field label="Email Address" value={dash(preview.metadata?.emailAddress)} />
          <Field
            label="Declared Attachment Count"
            value={dash(preview.metadata?.attachmentCount)}
          />
        </dl>
      </Panel>

      <Panel title="Plan Details">
        <dl className="fsp-submit__fields">
          <Field label="FSP ID" value={dash(preview.plan?.fspId)} />
          <Field label="Plan Name" value={dash(preview.plan?.planName)} />
          <Field label="Amendment Name" value={dash(preview.plan?.amendmentName)} />
          <Field
            label="Action"
            value={
              preview.plan?.actionDescription
                ? `${preview.plan.actionDescription} (${preview.plan.actionCode ?? ''})`
                : dash(preview.plan?.actionCode)
            }
          />
          <Field label="Approval Required" value={yesNo(preview.plan?.approvalRequired)} />
          <Field label="FRPA 197 Election" value={yesNo(preview.plan?.frpa197)} />
          <Field label="Transitional FSP" value={yesNo(preview.plan?.transitional)} />
          <Field
            label="Legal Doc Consolidated"
            value={yesNo(preview.plan?.legalDocConsolidated)}
          />
          <Field label="FDU Update" value={yesNo(preview.plan?.fduUpdate)} />
          <Field
            label="Identified Areas Update"
            value={yesNo(preview.plan?.identifiedAreasUpdate)}
          />
          <Field
            label="Stocking Standards Update"
            value={yesNo(preview.plan?.stockingStandardUpdate)}
          />
        </dl>
      </Panel>

      <Panel title="Term & Dates">
        <dl className="fsp-submit__fields">
          <Field label="Plan Term" value={dash(preview.termAndDates?.planTermYears)} />
          <Field label="Plan Term" value={dash(preview.termAndDates?.planTermMonths)} />
          <Field label="Expiry Date" value={dash(preview.termAndDates?.planExpiryDate)} />
          {preview.termAndDates?.amendmentComment && (
            <Field
              label="Amendment Comment"
              value={preview.termAndDates.amendmentComment}
              wide
            />
          )}
        </dl>
      </Panel>

      <Panel title="Agreement Holders">
        {preview.agreementHolders.length === 0 ? (
          <p className="fsp-submit__empty">No agreement holders declared.</p>
        ) : (
          <SummaryTable
            headers={[
              { key: 'clientNumber', header: 'Client #' },
              { key: 'clientName', header: 'Name' },
            ]}
            rows={preview.agreementHolders.map((h, i) => ({
              id: `ah-${i}-${h.clientNumber}`,
              clientNumber: h.clientNumber,
              clientName: h.clientName ?? '—',
            }))}
          />
        )}
      </Panel>

      <Panel title="Districts">
        {preview.districts.length === 0 ? (
          <p className="fsp-submit__empty">No districts declared.</p>
        ) : (
          <SummaryTable
            headers={[
              { key: 'orgUnitCode', header: 'Code' },
              { key: 'orgUnitName', header: 'Name' },
            ]}
            rows={preview.districts.map((d, i) => ({
              id: `dist-${i}-${d.orgUnitCode}`,
              orgUnitCode: d.orgUnitCode,
              orgUnitName: d.orgUnitName ?? '—',
            }))}
          />
        )}
      </Panel>

      <Panel title={`Forest Development Units (${preview.fdus.length})`}>
        {preview.fdus.length === 0 ? (
          <p className="fsp-submit__empty">No FDUs in this submission.</p>
        ) : (
          <SummaryTable
            headers={[
              { key: 'name', header: 'Name' },
              { key: 'licenceCount', header: 'Licences' },
              { key: 'polygonCount', header: 'Polygons' },
              { key: 'srsName', header: 'SRS' },
            ]}
            rows={preview.fdus.map((f, i) => ({
              id: `fdu-${i}`,
              name: dash(f.name),
              licenceCount: String(f.licenceCount),
              polygonCount: String(f.polygonCount),
              srsName: dash(f.srsName),
            }))}
          />
        )}
      </Panel>

      <Panel title={`Identified Areas (${preview.identifiedAreas.length})`}>
        {preview.identifiedAreas.length === 0 ? (
          <p className="fsp-submit__empty">No identified areas in this submission.</p>
        ) : (
          <SummaryTable
            headers={[
              { key: 'name', header: 'Name' },
              { key: 'legislationType', header: 'Legislation' },
              { key: 'polygonCount', header: 'Polygons' },
              { key: 'srsName', header: 'SRS' },
            ]}
            rows={preview.identifiedAreas.map((a, i) => ({
              id: `ia-${i}`,
              name: dash(a.name),
              legislationType: dash(a.legislationType),
              polygonCount: String(a.polygonCount),
              srsName: dash(a.srsName),
            }))}
          />
        )}
      </Panel>

      <Panel title={`Stocking Standards (${preview.stockingStandards.length})`}>
        {preview.stockingStandards.length === 0 ? (
          <p className="fsp-submit__empty">No new stocking standards regimes declared.</p>
        ) : (
          <SummaryTable
            headers={[
              { key: 'name', header: 'Regime Name' },
              { key: 'layerCount', header: 'Layers' },
            ]}
            rows={preview.stockingStandards.map((s, i) => ({
              id: `ss-${i}`,
              name: dash(s.name),
              layerCount: String(s.layerCount),
            }))}
          />
        )}
      </Panel>

      <Panel title={`Staged Attachments (${attachments.length})`}>
        <AttachmentList attachments={attachments} />
      </Panel>
    </Stack>
  );
}

// ── Tables / utilities ────────────────────────────────────────────

function SummaryTable({
  headers,
  rows,
}: {
  headers: Array<{ key: string; header: string }>;
  rows: Array<Record<string, string>>;
}) {
  return (
    <div className="bordered-table">
      <TableContainer>
        <Table size="md" useZebraStyles>
          <TableHead>
            <TableRow>
              {headers.map((h) => (
                <TableHeader key={h.key}>{h.header}</TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {headers.map((h) => (
                  <TableCell key={h.key}>{row[h.key]}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function AttachmentSummary({
  attachments,
  expected,
}: {
  attachments: File[];
  expected: number | null;
}) {
  if (expected == null) return null;
  if (attachments.length === expected) return null;
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <InlineNotification
        kind={attachments.length < expected ? 'warning' : 'info'}
        lowContrast
        hideCloseButton
        title={`Declared ${expected} attachment${expected === 1 ? '' : 's'}; ${attachments.length} staged.`}
        subtitle={
          attachments.length < expected
            ? `Add ${expected - attachments.length} more file${
                expected - attachments.length === 1 ? '' : 's'
              } to match the count declared in the XML.`
            : 'You can submit more files than declared, but the count mismatch may confuse downstream processing.'
        }
      />
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: File[] }) {
  if (attachments.length === 0) {
    return <p className="fsp-submit__empty">No attachments staged.</p>;
  }
  return (
    <SummaryTable
      headers={[
        { key: 'name', header: 'Filename' },
        { key: 'size', header: 'Size' },
        { key: 'type', header: 'Type' },
      ]}
      rows={attachments.map((f, i) => ({
        id: `att-${i}-${f.name}`,
        name: f.name,
        size: formatBytes(f.size),
        type: f.type || '—',
      }))}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ErrorTable({ errors }: { errors: SubmissionValidationError[] }) {
  return (
    <StructuredListWrapper isCondensed>
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>Location</StructuredListCell>
          <StructuredListCell head>Code</StructuredListCell>
          <StructuredListCell head>Message</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {errors.map((e, i) => (
          <StructuredListRow key={i} className="fsp-submit__error-row">
            <StructuredListCell>
              {e.path ? <code>{e.path}</code> : '—'}
            </StructuredListCell>
            <StructuredListCell>
              <code>{e.code}</code>
            </StructuredListCell>
            <StructuredListCell>{e.message}</StructuredListCell>
          </StructuredListRow>
        ))}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

function SuccessBanner({ saved }: { saved: FspInformation }): React.ReactElement {
  const navigate = useNavigate();
  const id = saved.fspId ?? '?';
  const name = saved.fspPlanName ?? '';
  const detailHref = saved.fspId
    ? `/fsp/information?fspId=${encodeURIComponent(saved.fspId)}`
    : null;
  return (
    <ActionableNotification
      className="fsp-submit__success-banner"
      kind="success"
      lowContrast
      hideCloseButton
      title={`FSP ${id} saved.`}
      subtitle={name || ''}
      actionButtonLabel={detailHref ? 'Open FSP details' : ''}
      onActionButtonClick={() => detailHref && navigate(detailHref)}
    />
  );
}

function renderSubmissionOutcome(
  outcome: Exclude<SubmissionOutcome, { kind: 'created' }>,
): React.ReactNode {
  if (outcome.kind === 'invalid') {
    return (
      <InlineNotification
        kind="error"
        lowContrast
        hideCloseButton
        title="Submission rejected — validation errors"
        subtitle="No data was persisted. Review the issues panel above and re-upload."
      />
    );
  }
  return (
    <InlineNotification
      kind="error"
      lowContrast
      hideCloseButton
      title={`Submission failed (HTTP ${outcome.status})`}
      subtitle={outcome.message}
    />
  );
}
