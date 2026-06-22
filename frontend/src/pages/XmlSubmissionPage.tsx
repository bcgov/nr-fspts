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
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_FILENAME_LEN,
  validateAttachmentFile,
} from '@/lib/attachmentConstraints';
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
    // Reject the whole batch on the first constraint violation so the
    // user fixes the offending file rather than silently uploading a
    // partial set. validateAttachmentFile handles extension allow-list,
    // 50-char filename cap, and the 50 MB size cap.
    for (const file of list) {
      const problem = validateAttachmentFile(file);
      if (problem) {
        display({
          kind: 'error',
          title: problem.title,
          subtitle: `${file.name}: ${problem.subtitle}`,
          timeout: 0,
        });
        setAttachments([]);
        return;
      }
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
              labelDescription={
                `Optional. Multiple files allowed. `
                + `Allowed: ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}. `
                + `File name max ${MAX_ATTACHMENT_FILENAME_LEN} chars. `
                + `Max 50 MB per file.`
              }
              buttonLabel="Add files"
              multiple
              filenameStatus="edit"
              // OS picker filters to the allow-list; onAttachmentsChange
              // re-checks because drag-and-drop bypasses `accept`.
              accept={[...ACCEPTED_ATTACHMENT_EXTENSIONS]}
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

// "5 years, 0 months" — mirrors the formatter on the FSP Information
// read-only pane. Both halves blank → em-dash; one filled → the other
// defaults to 0 so partial entry still reads cleanly.
const formatTerm = (
  years: number | null | undefined,
  months: number | null | undefined,
): string => {
  const y = years ?? null;
  const m = months ?? null;
  if (y == null && m == null) return '—';
  return `${y ?? 0} years, ${m ?? 0} months`;
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
          <Field label="Contact name" value={dash(preview.metadata?.contactName)} />
          <Field label="Telephone number" value={dash(preview.metadata?.telephoneNumber)} />
          <Field label="Email address" value={dash(preview.metadata?.emailAddress)} />
          <Field
            label="Declared attachment count"
            value={dash(preview.metadata?.attachmentCount)}
          />
        </dl>
      </Panel>

      <Panel title="Plan Details">
        <dl className="fsp-submit__fields">
          <Field label="FSP ID" value={dash(preview.plan?.fspId)} />
          <Field label="Plan name" value={dash(preview.plan?.planName)} />
          <Field label="Amendment name" value={dash(preview.plan?.amendmentName)} />
          <Field
            label="Action"
            value={
              preview.plan?.actionDescription
                ? `${preview.plan.actionDescription} (${preview.plan.actionCode ?? ''})`
                : dash(preview.plan?.actionCode)
            }
          />
          <Field label="Approval required" value={yesNo(preview.plan?.approvalRequired)} />
          <Field label="FRPA 197 election" value={yesNo(preview.plan?.frpa197)} />
          <Field label="Transitional FSP" value={yesNo(preview.plan?.transitional)} />
          <Field
            label="Legal doc consolidated"
            value={yesNo(preview.plan?.legalDocConsolidated)}
          />
          <Field label="FDU update" value={yesNo(preview.plan?.fduUpdate)} />
          <Field
            label="Identified areas update"
            value={yesNo(preview.plan?.identifiedAreasUpdate)}
          />
          <Field
            label="Stocking standards update"
            value={yesNo(preview.plan?.stockingStandardUpdate)}
          />
        </dl>
      </Panel>

      <Panel title="Term & Dates">
        <dl className="fsp-submit__fields fsp-submit__fields--3col">
          {/*
            Effective Date | Term | Expiry Date on a single row — same
            shape and ordering as the Information read-only pane. Term
            collapses Years + Months into "X years, Y months".
          */}
          <Field
            label="Effective date"
            value={dash(preview.termAndDates?.planStartDate)}
          />
          <Field
            label="Term"
            value={formatTerm(
              preview.termAndDates?.planTermYears,
              preview.termAndDates?.planTermMonths,
            )}
          />
          <Field
            label="Expiry date"
            value={dash(preview.termAndDates?.planExpiryDate)}
          />
          {preview.termAndDates?.amendmentComment && (
            <Field
              label="Amendment comment"
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
          // Columns mirror the FSP Stocking Standards selection table —
          // ID, Name, Objective, BGC, Layers. Status / Effective Date /
          // Default / Amendment Number are on the FSP table but aren't
          // in the submission XML (they're set during persistence) so
          // they're not surfaced here.
          <SummaryTable
            headers={[
              { key: 'standardsId', header: 'Standards ID' },
              { key: 'name', header: 'Standards name' },
              { key: 'objective', header: 'Objective' },
              { key: 'bgc', header: 'BGC' },
              { key: 'layerCount', header: 'Layers' },
            ]}
            rows={preview.stockingStandards.map((s, i) => ({
              id: `ss-${i}`,
              standardsId: dash(s.id),
              name: dash(s.name),
              objective: dash(s.objective),
              bgc: s.bgcSummary
                ? s.bgcCount > 1
                  ? `${s.bgcSummary} (${s.bgcCount})`
                  : s.bgcSummary
                : '—',
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

// Human-friendly labels for the backend validation codes. Source of
// truth: every `SubmissionValidationError.of(...)` call site in
// backend/src/main/java/.../submission/. Keep in sync when new codes
// are added on either side — unknown codes render as the raw code,
// which is the right failure mode (never a blank cell).
const VALIDATION_CODE_LABELS: Record<string, string> = {
  // Format detection
  FORMAT_UNRECOGNIZED: 'Unrecognized file format',
  // XML pipeline
  XML_READ: 'XML read failure',
  XML_PARSE: 'XML parse error',
  XSD: 'Schema validation error',
  JAXB: 'XML content error',
  // GeoJSON pipeline
  GEOJSON_PARSE: 'GeoJSON parse error',
  GEOJSON_SCHEMA: 'GeoJSON schema error',
  GEOJSON_FIELD: 'GeoJSON field error',
  GEOJSON_MISSING_FSP: 'GeoJSON missing FSP block',
  GEOJSON_UNRECOGNIZED: 'GeoJSON shape not recognized',
  // Geometry
  GEOMETRY_MISSING: 'Geometry missing',
  GEOMETRY_UNSUPPORTED: 'Unsupported geometry type',
  GEOMETRY_PARSE_ERROR: 'Geometry parse error',
  GEOMETRY_INVALID: 'Invalid geometry topology',
  GEOMETRY_OUTSIDE_BC: 'Geometry outside BC boundary',
  SRS_UNSUPPORTED: 'Unsupported coordinate system',
  SIMPLIFY_INVALID: 'Simplification produced invalid geometry',
  // actionCode preconditions (Amendment / Replacement)
  FSP_ID_REQUIRED: 'fspID required',
  FSP_NO_APPROVED_AMENDMENT: 'FSP has no Approved or In-Effect amendment',
  // Licence registry
  LICENCE_NOT_FOUND: 'Unknown licence number',
  // Plan term vs expiry XOR
  PLAN_TERM_OR_EXPIRY_EXCLUSIVE: 'Plan term and expiry both supplied',
  // Header content rules
  PLAN_NAME_REQUIRED: 'planName required',
  AGREEMENT_HOLDER_REQUIRED: 'Agreement holder required',
  AGREEMENT_HOLDER_NOT_FOUND: 'Unknown agreement holder client number',
  DUPLICATE_AGREEMENT_HOLDER: 'Duplicate agreement holder',
  DISTRICT_REQUIRED: 'District required',
  UNKNOWN_DISTRICT: 'Unknown district code',
  DUPLICATE_DISTRICT: 'Duplicate district',
  DUPLICATE_FDU_NAME: 'Duplicate FDU name',
  DUPLICATE_IDENTIFIED_AREA_NAME: 'Duplicate identified-area name',
  INVALID_LEGISLATION_TYPE: 'Invalid legislationTypeCode',
};

const labelFor = (code: string): string => VALIDATION_CODE_LABELS[code] ?? code;

// Xerces tags every XSD failure with a "cvc-…:" constraint id (e.g.
// "cvc-enumeration-valid: Value 'X' is not facet-valid…",
// "cvc-type.3.1.3: The value 'Y'…"). Useful for debugging the schema
// but unhelpful in the UI — strip the prefix and any whitespace so the
// human-readable sentence is what shows in the Detail column. The raw
// API response still carries the unmodified message.
const CVC_PREFIX = /^cvc-[a-z0-9.\-]+:\s*/i;
const cleanDetail = (message: string | null | undefined): string =>
  (message ?? '').replace(CVC_PREFIX, '').trim();

function ErrorTable({ errors }: { errors: SubmissionValidationError[] }) {
  return (
    <StructuredListWrapper isCondensed>
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>Location</StructuredListCell>
          <StructuredListCell head>Issue</StructuredListCell>
          <StructuredListCell head>Detail</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {errors.map((e, i) => (
          <StructuredListRow key={i} className="fsp-submit__error-row">
            <StructuredListCell>
              {e.path ? <code>{e.path}</code> : '—'}
            </StructuredListCell>
            <StructuredListCell>{labelFor(e.code)}</StructuredListCell>
            <StructuredListCell>{cleanDetail(e.message)}</StructuredListCell>
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
