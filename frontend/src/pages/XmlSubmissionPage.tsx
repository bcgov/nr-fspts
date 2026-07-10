import { useEffect, useRef, useState } from 'react';
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

// The view state machine is unchanged from the previous implementation
// — it tracks the *backend* lifecycle of the chosen file. The wizard
// step (Upload vs Review) is a separate UI concern layered on top.
type ViewState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'validated'; result: SubmissionValidationResult }
  | { kind: 'submitting' }
  | { kind: 'submission'; outcome: SubmissionOutcome };

type WizardStep = 'upload' | 'review';

const MAX_BYTES = 50 * 1024 * 1024;
const XML_ACCEPT = '.xml,.json,.geojson';

// ── Per-submission-type notification copy ─────────────────────────
// FSP Data Submission notifications spec (client-confirmed). The XML's
// actionCode drives the wording: I (initial), A (amendment), R
// (replacement), U (update). Minor amendments (no DDM approval) also land
// as a draft at upload, so they share the 'A' wording — the in-effect
// transition happens later at submit-for-decision, not here.
type SubmissionType = 'I' | 'A' | 'R' | 'U';

interface SubmissionCopy {
  /** Title of the success notif once the file validates cleanly. */
  validatedTitle: string;
  /** Noun in the "[N] issue(s) found in {noun}" error title. */
  errorNoun: string;
  /** Step 2 (Review) primary button label — replaces the generic "Submit". */
  submitLabel: string;
  confirmTitle: string;
  /** Sentence after the bold "FSP {id} {name}" in the confirmation. */
  confirmBody: string;
  /** CTA label; receives the FSP id. */
  confirmCta: (id: string) => string;
}

const SUBMISSION_COPY: Record<SubmissionType, SubmissionCopy> = {
  I: {
    validatedTitle: 'New FSP submission validated',
    errorNoun: 'new FSP submission',
    submitLabel: 'Save draft',
    confirmTitle: 'FSP draft created',
    confirmBody:
      'has been saved as a draft. Review your draft and submit it when ready.',
    confirmCta: (id) => `Open FSP ${id} draft`,
  },
  A: {
    validatedTitle: 'FSP amendment validated',
    errorNoun: 'FSP amendment',
    submitLabel: 'Save amendment draft',
    confirmTitle: 'Amendment draft created',
    confirmBody:
      'has been saved as an amendment draft. Review your draft and submit it when ready.',
    confirmCta: (id) => `Open FSP ${id} draft`,
  },
  R: {
    validatedTitle: 'FSP replacement validated',
    errorNoun: 'FSP replacement',
    submitLabel: 'Save replacement draft',
    confirmTitle: 'Replacement draft created',
    confirmBody:
      'has been saved as a replacement draft. Review your draft and submit it when ready.',
    confirmCta: (id) => `Open FSP ${id} draft`,
  },
  U: {
    validatedTitle: 'FSP update validated',
    errorNoun: 'FSP update',
    submitLabel: 'Update FSP',
    confirmTitle: 'FSP updated',
    confirmBody: 'has been updated successfully.',
    confirmCta: (id) => `Open FSP ${id}`,
  },
};

/** Map the raw XML actionCode onto a {@link SubmissionType} (defaults to I). */
const toSubmissionType = (code: string | null | undefined): SubmissionType => {
  switch ((code ?? '').toUpperCase()) {
    case 'A':
      return 'A';
    case 'R':
      return 'R';
    case 'U':
      return 'U';
    default:
      return 'I';
  }
};

export default function XmlSubmissionPage() {
  const { display } = useNotification();
  const navigate = useNavigate();
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'idle' });
  const [step, setStep] = useState<WizardStep>('upload');
  // `sizeError` mirrors the mockup's inline `.field-error` under the
  // dropzone (states s6-filesize). It supplements the existing toast.
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Mockup s2-no-file: the Review button stays enabled; clicking it without a
  // file surfaces this inline error rather than the button being disabled.
  const [noFileError, setNoFileError] = useState(false);
  // The submission type resolved from the last validated file's actionCode.
  // Captured here so the confirmation screen (which only receives the saved
  // FSP) can still pick the right wording. Defaults to Initial.
  const [subType, setSubType] = useState<SubmissionType>('I');

  const xmlInputRef = useRef<HTMLInputElement | null>(null);

  // Upload edge cases (spec §2): empty file and over-size, each with its
  // own copy. Returns the message to surface, or null when the file is fine.
  const validateFile = (file: File): string | null => {
    if (file.size === 0) {
      return 'The uploaded file contains no content. Please check your file and try again.';
    }
    if (file.size > MAX_BYTES) {
      return 'File exceeds size limit. Maximum file size is 50 MB.';
    }
    return null;
  };

  // ── XML file selection (shared by hidden input + drag-and-drop) ──
  const acceptXmlFile = (file: File | null) => {
    if (!file) return;
    const err = validateFile(file);
    if (err) {
      setSizeError(err);
      setXmlFile(file);
      setView({ kind: 'idle' });
      display({
        kind: 'error',
        title: file.size === 0 ? 'Empty file' : 'File too large',
        subtitle: err,
        timeout: 6000,
      });
      return;
    }
    setSizeError(null);
    setXmlFile(file);
  };

  const onXmlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    acceptXmlFile(file);
    // Allow re-selecting the same filename later.
    e.target.value = '';
  };

  const onXmlDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // The whole page is also a drop target (see the .fsp-submit handlers);
    // stop here so a drop on the zone isn't processed twice.
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    acceptXmlFile(file);
  };

  // Page-wide drag/drop: users can drop the file anywhere on the Upload step,
  // not just in the dnd-zone. preventDefault on dragover is required for the
  // drop event to fire; we reuse the dnd-zone's drag highlight as the cue
  // (no layout change). dragleave only clears when the cursor actually leaves
  // the page container (relatedTarget check) so the highlight doesn't flicker
  // as it crosses child elements.
  const onPageDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (step !== 'upload') return;
    e.preventDefault();
    setDragOver(true);
  };
  const onPageDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (step !== 'upload') return;
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  };
  const onPageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (step !== 'upload') return;
    e.preventDefault();
    setDragOver(false);
    acceptXmlFile(e.dataTransfer.files?.[0] ?? null);
  };

  const removeXmlFile = () => {
    setXmlFile(null);
    setSizeError(null);
    setView({ kind: 'idle' });
    setStep('upload');
  };

  // Auto-validate whenever a new (size-valid) XML file is picked. The
  // user doesn't have to click anything — the notif lights up as soon
  // as the backend returns.
  useEffect(() => {
    if (!xmlFile || xmlFile.size === 0) return;
    if (xmlFile.size > MAX_BYTES) return; // size guard owns this case
    let cancelled = false;
    setView({ kind: 'validating' });
    validateSubmission(xmlFile)
      .then((result) => {
        if (cancelled) return;
        setSubType(toSubmissionType(result.preview?.plan?.actionCode));
        setView({ kind: 'validated', result });
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
      const outcome = await submitSubmission(xmlFile);
      setView({ kind: 'submission', outcome });
      if (outcome.kind === 'created') {
        display({
          kind: 'success',
          title: 'Submission accepted',
          subtitle: `FSP ${outcome.saved.fspId ?? ''} saved.`,
          timeout: 6000,
        });
      } else if (outcome.kind === 'invalid') {
        // Validation failed at persist time — drop back to the Upload
        // step so the issue list / notif is visible against the file.
        setStep('upload');
        display({
          kind: 'error',
          title: 'Submission rejected',
          subtitle: 'Validation errors — no data was persisted.',
          timeout: 6000,
        });
      } else {
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

  const preview = derivePreview(view);
  const validating = view.kind === 'validating';
  const submitting = view.kind === 'submitting';
  const validFile = view.kind === 'validated' && view.result.valid && xmlFile != null;
  const canReview = validFile;

  const successOutcome =
    view.kind === 'submission' && view.outcome.kind === 'created' ? view.outcome : null;

  // ── Confirmation screen (mockup s8-confirm) ──
  if (successOutcome) {
    return (
      <div className="fsp-submit">
        <ConfirmScreen
          saved={successOutcome.saved}
          type={subType}
          onOpenDraft={(href) => navigate(href)}
        />
      </div>
    );
  }

  return (
    <div
      className="fsp-submit"
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      <div className="screen">
        {/* ── Page header + stepper ── */}
        <div className="page-header">
          <h1 className="page-header__title">Data submission</h1>
          <p className="page-header__subtitle">
            Upload an XML or GeoJSON file to create, amend, replace, or update an FSP
          </p>
          <div className="stepper" role="list">
            <div
              className={`step${step === 'upload' ? ' s-current' : ' s-complete'}`}
              role="listitem"
              {...(step === 'upload' ? { 'aria-current': 'step' as const } : {})}
            >
              <div className="step-inner">
                <div
                  className={`step-dot ${step === 'upload' ? 'd-current' : 'd-complete'}`}
                />
                <span className="step-name">1. Upload</span>
              </div>
            </div>
            <div
              className={`step${step === 'review' ? ' s-current' : ''}`}
              role="listitem"
              {...(step === 'review' ? { 'aria-current': 'step' as const } : {})}
            >
              <div className="step-inner">
                <div
                  className={`step-dot ${step === 'review' ? 'd-current' : 'd-incomplete'}`}
                />
                <span className="step-name">2. Review</span>
              </div>
            </div>
          </div>
        </div>

        {step === 'upload' ? (
          <UploadStep
            xmlFile={xmlFile}
            view={view}
            sizeError={sizeError}
            noFileError={noFileError}
            dragOver={dragOver}
            validating={validating}
            xmlInputRef={xmlInputRef}
            onXmlInputChange={onXmlInputChange}
            onXmlDrop={onXmlDrop}
            setDragOver={setDragOver}
            removeXmlFile={removeXmlFile}
            onReview={() => {
              if (canReview) {
                setNoFileError(false);
                setStep('review');
              } else if (xmlFile == null) {
                setNoFileError(true);
              }
              // file present but invalid/validating: the notif already
              // explains; don't advance.
            }}
          />
        ) : (
          <ReviewStep
            preview={preview}
            submitting={submitting}
            onBack={() => setStep('upload')}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {/* Full-page overlay while the submission is persisting — keeps the
          review details visible behind it and blocks interaction. */}
      {submitting && (
        <div
          className="submit-overlay"
          role="status"
          aria-live="polite"
          aria-label="Submitting"
        >
          <div className="submit-overlay__spinner" aria-hidden="true" />
          <span className="submit-overlay__label">Submitting…</span>
        </div>
      )}
    </div>
  );
}

// ── Step 1: Upload ────────────────────────────────────────────────

interface UploadStepProps {
  xmlFile: File | null;
  view: ViewState;
  sizeError: string | null;
  noFileError: boolean;
  dragOver: boolean;
  validating: boolean;
  xmlInputRef: React.RefObject<HTMLInputElement | null>;
  onXmlInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onXmlDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  setDragOver: (v: boolean) => void;
  removeXmlFile: () => void;
  onReview: () => void;
}

function UploadStep(props: UploadStepProps) {
  const {
    xmlFile,
    view,
    sizeError,
    noFileError,
    dragOver,
    validating,
    xmlInputRef,
    onXmlInputChange,
    onXmlDrop,
    setDragOver,
    removeXmlFile,
    onReview,
  } = props;

  const openXmlDialog = () => xmlInputRef.current?.click();

  const validationResult = view.kind === 'validated' ? view.result : null;
  const hasErrors =
    validationResult != null && !validationResult.valid && validationResult.errors.length > 0;

  return (
    <>
      <div className="page-content">
        <h2 className="section-heading">Upload</h2>
        <p className="section-subtitle">
          The submission type will be detected automatically from your file.
        </p>

        <div className={`card${sizeError || hasErrors ? ' card--full' : ''}`}>
          <span className="field-label" id="fsp-submit-xml-label">
            Submission file
          </span>
          <p className="field-helper">
            Accepted formats: XML or GeoJSON. Maximum file size: 50 MB.
          </p>

          {/* Hidden native input backing both click-to-upload and the
              OS file dialog. Drag-and-drop is handled on the dnd-zone. */}
          <input
            ref={xmlInputRef}
            type="file"
            className="visually-hidden-input"
            accept={XML_ACCEPT}
            data-testid="xml-file-input"
            aria-labelledby="fsp-submit-xml-label"
            onChange={onXmlInputChange}
          />

          <div
            className={`dnd-zone${dragOver ? ' dnd-zone--drag' : ''}`}
            role="button"
            tabIndex={0}
            data-testid="xml-dropzone"
            aria-label="Drag and drop files here or click to upload submission file"
            onClick={openXmlDialog}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openXmlDialog();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onXmlDrop}
          >
            <span className="dnd-zone__label">
              Drag and drop files here or click to upload
            </span>
          </div>

          {xmlFile && (
            <FileChip
              name={xmlFile.name}
              state={sizeError ? 'error' : validating ? 'validating' : hasErrors ? 'error' : 'ok'}
              onRemove={removeXmlFile}
            />
          )}

          {/* Size error mirrors mockup s6-filesize inline field-error */}
          {sizeError && (
            <p className="field-error" role="alert" style={{ marginTop: '6px' }}>
              <ErrorIcon size={14} />
              {sizeError}
            </p>
          )}

          {/* No-file error mirrors mockup s2-no-file: shown when Review is
              clicked with nothing uploaded. Auto-hides once a file exists. */}
          {noFileError && !xmlFile && (
            <p className="field-error" role="alert" style={{ marginTop: '6px' }}>
              <ErrorIcon size={14} />
              Please upload a file before continuing.
            </p>
          )}

          {/* Validation notif (info / success / error) — mockup s3/s4/s5 */}
          {!sizeError && <ValidationNotif view={view} fileName={xmlFile?.name ?? null} />}

          {/* Validation issues table — mockup s5-errors */}
          {hasErrors && validationResult && (
            <ValidationIssuesTable errors={validationResult.errors} />
          )}
        </div>
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="review-button"
          disabled={validating || hasErrors}
          onClick={onReview}
        >
          {validating ? 'Validating' : 'Review'}
          {validating ? <SpinnerIcon /> : <ArrowRightIcon />}
        </button>
      </div>
    </>
  );
}

// ── File chip (mockup .file-chip) ─────────────────────────────────

function FileChip({
  name,
  state,
  onRemove,
}: {
  name: string;
  state: 'ok' | 'validating' | 'error';
  onRemove: () => void;
}) {
  return (
    <div
      className={`file-chip${state === 'error' ? ' file-chip--error' : ''}`}
      style={{ marginTop: '8px' }}
      data-testid="xml-file-chip"
    >
      <span className="file-chip__icon">
        <DocumentIcon />
      </span>
      <span className="file-chip__name">{name}</span>
      {state === 'validating' && (
        <span className="file-chip__status">
          <SpinnerIcon color="var(--fds-interactive)" />
        </span>
      )}
      {state === 'error' && (
        <span className="file-chip__status" style={{ color: 'var(--fds-support-error)' }}>
          <ErrorIcon size={16} color="var(--fds-support-error)" />
        </span>
      )}
      <button
        type="button"
        className="file-chip__remove"
        aria-label="Remove file"
        data-testid="xml-file-remove"
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// ── Validation notif (mockup .notif --info/--success/--error) ─────

function ValidationNotif({ view, fileName }: { view: ViewState; fileName: string | null }) {
  if (view.kind === 'validating') {
    return (
      <div className="notif notif--info" role="status" aria-live="polite" style={{ marginTop: '16px' }}>
        <span className="notif__icon">
          <InfoIcon />
        </span>
        <div>
          <div className="notif__title">Validating file</div>
          <div className="notif__msg">Running schema, geometry, and envelope checks…</div>
        </div>
      </div>
    );
  }
  if (view.kind === 'validated') {
    const copy = SUBMISSION_COPY[toSubmissionType(view.result.preview?.plan?.actionCode)];
    if (view.result.valid) {
      return (
        <div
          className="notif notif--success"
          role="status"
          aria-live="polite"
          style={{ marginTop: '16px' }}
        >
          <span className="notif__icon">
            <CheckIcon />
          </span>
          <div>
            <div className="notif__title">{copy.validatedTitle}</div>
            <div className="notif__msg">
              {fileName ? `"${fileName}" was uploaded with no issues found.` : 'No issues found.'}
            </div>
          </div>
        </div>
      );
    }
    const n = view.result.errors.length;
    return (
      <div className="notif notif--error" role="alert" aria-live="assertive" style={{ marginTop: '16px' }}>
        <span className="notif__icon">
          <InfoIcon />
        </span>
        <div>
          <div className="notif__title">
            {n} issue{n === 1 ? '' : 's'} found in {copy.errorNoun}
          </div>
          <div className="notif__msg">
            Correct the issues in your source file, then replace the file to continue.
          </div>
        </div>
      </div>
    );
  }
  // submission-level error (non-422) surfaced on the upload step.
  if (view.kind === 'submission' && view.outcome.kind === 'error') {
    return (
      <div className="notif notif--error" role="alert" aria-live="assertive" style={{ marginTop: '16px' }}>
        <span className="notif__icon">
          <InfoIcon />
        </span>
        <div>
          <div className="notif__title">Submission failed (HTTP {view.outcome.status})</div>
          <div className="notif__msg">{view.outcome.message}</div>
        </div>
      </div>
    );
  }
  return null;
}

// ── Validation issues table (mockup .vtable, s5-errors) ───────────

const VALIDATION_CODE_LABELS: Record<string, string> = {
  VIRUS_DETECTED: 'Virus detected',
  VIRUS_SCAN_UNAVAILABLE: 'Virus scan unavailable',
  UPLOAD_MISSING: 'File missing',
  FORMAT_UNRECOGNIZED: 'Unrecognized file format',
  ENVELOPE_PARSE_ERROR: 'Envelope parse error',
  ENVELOPE_UNRECOGNIZED: 'Unrecognized envelope format',
  ENVELOPE_MISSING_CONTENT: 'Envelope missing content',
  ENVELOPE_NOT_FSP: 'Envelope does not contain an FSP',
  ENVELOPE_EXTRACTION_FAILED: 'Could not extract submission from envelope',
  XML_READ: 'XML read failure',
  XML_PARSE: 'XML parse error',
  XSD: 'Schema validation error',
  JAXB: 'XML content error',
  GEOJSON_PARSE: 'GeoJSON parse error',
  GEOJSON_SCHEMA: 'GeoJSON schema error',
  GEOJSON_FIELD: 'GeoJSON field error',
  GEOJSON_MISSING_FSP: 'GeoJSON missing FSP block',
  GEOJSON_UNRECOGNIZED: 'GeoJSON shape not recognized',
  GEOMETRY_MISSING: 'Geometry missing',
  GEOMETRY_UNSUPPORTED: 'Unsupported geometry type',
  GEOMETRY_PARSE_ERROR: 'Geometry parse error',
  GEOMETRY_INVALID: 'Invalid geometry topology',
  GEOMETRY_OUTSIDE_BC: 'Geometry outside BC boundary',
  SRS_UNSUPPORTED: 'Unsupported coordinate system',
  SIMPLIFY_INVALID: 'Simplification produced invalid geometry',
  FSP_ID_REQUIRED: 'fspID required',
  FSP_NO_APPROVED_AMENDMENT: 'FSP has no Approved or In-Effect amendment',
  LICENCE_NOT_FOUND: 'Unknown licence number',
  PLAN_TERM_OR_EXPIRY_EXCLUSIVE: 'Plan term and expiry both supplied',
  PLAN_TERM_OR_END_DATE_REQUIRED: 'Plan term or end date required',
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

// Humanize an unmapped SCREAMING_SNAKE_CASE code as a last resort, so a new
// backend code never surfaces raw (e.g. NEW_CODE → 'New code').
const humanizeCode = (code: string): string => {
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
};

const labelFor = (code: string): string =>
  VALIDATION_CODE_LABELS[code] ?? humanizeCode(code);

// Xerces tags every XSD failure with a "cvc-…:" constraint id; strip it
// so the human-readable sentence is what shows in the Detail column.
const CVC_PREFIX = /^cvc-[a-z0-9.\-]+:\s*/i;
const cleanDetail = (message: string | null | undefined): string =>
  (message ?? '').replace(CVC_PREFIX, '').trim();

function ValidationIssuesTable({ errors }: { errors: SubmissionValidationError[] }) {
  const csvHref = buildIssuesCsv(errors);
  return (
    <div className="vtable-wrap" style={{ marginTop: '16px' }}>
      <div className="vtable-header">
        <span className="vtable-header__title">Validation issues ({errors.length})</span>
        <a
          className="vtable-download"
          href={csvHref}
          download="fsp-validation-issues.csv"
          aria-label="Download issues as CSV"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '14px',
            color: '#005cb8',
            textDecoration: 'none',
          }}
        >
          Download issues (.csv)
          <DownloadIcon />
        </a>
      </div>
      <table className="vtable" aria-label="Validation issues">
        <thead>
          <tr>
            <th className="col-issue" scope="col">
              Issue
            </th>
            <th className="col-loc" scope="col">
              File location
            </th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={i} data-testid="validation-issue-row">
              <td className="col-issue">{labelFor(e.code)}</td>
              <td className="col-loc">{e.path ? <code>{e.path}</code> : '—'}</td>
              <td>{cleanDetail(e.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildIssuesCsv(errors: SubmissionValidationError[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    ['Issue', 'File location', 'Detail'],
    ...errors.map((e) => [labelFor(e.code), e.path ?? '', cleanDetail(e.message)]),
  ];
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}

// ── Step 2: Review ────────────────────────────────────────────────

function ReviewStep({
  preview,
  submitting,
  onBack,
  onSubmit,
}: {
  preview: SubmissionPreview | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  // Button label tracks the submission type (I/A/R/U) so it reads e.g.
  // "Save amendment draft" instead of a generic "Submit".
  const submitLabel = SUBMISSION_COPY[toSubmissionType(preview?.plan?.actionCode)].submitLabel;
  return (
    <>
      <div className="page-content">
        <h2 className="section-heading">Review</h2>
        <p className="section-subtitle">
          Review the details extracted from your file and submit when ready
        </p>

        {preview ? (
          <ReviewSections preview={preview} />
        ) : (
          <div className="review-section">
            <p className="empty-state">No parsed submission details available.</p>
          </div>
        )}
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--ghost"
          data-testid="back-button"
          disabled={submitting}
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginLeft: '8px' }}
          data-testid="submit-button"
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Submitting' : submitLabel}
          {submitting ? <SpinnerIcon /> : <ArrowRightIcon />}
        </button>
      </div>
    </>
  );
}

const dash = (v: string | number | null | undefined): React.ReactNode =>
  v == null || v === '' ? <span className="empty">—</span> : String(v);

const yesNo = (v: boolean | null | undefined): React.ReactNode => {
  if (v == null) return <span className="empty">—</span>;
  return v ? 'Yes' : 'No';
};

const formatTerm = (
  years: number | null | undefined,
  months: number | null | undefined,
): React.ReactNode => {
  const y = years ?? null;
  const m = months ?? null;
  if (y == null && m == null) return <span className="empty">—</span>;
  return `${y ?? 0} years, ${m ?? 0} months`;
};

function ReviewSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="review-section">
      <div className="review-section__title">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function SList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <table className="slist">
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={i}>
            <td>{label}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DTable({
  headers,
  rows,
  ariaLabel,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  ariaLabel: string;
}) {
  return (
    <div className="dtable-wrap">
      <table className="dtable" aria-label={ariaLabel}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewSections({
  preview,
}: {
  preview: SubmissionPreview;
}) {
  // actionCode (I-U-R-A) surfaced in the Plan details Action row.
  const actionValue = preview.plan?.actionDescription
    ? `${preview.plan.actionDescription} (${preview.plan.actionCode ?? ''})`
    : dash(preview.plan?.actionCode);

  return (
    <>
      <ReviewSection title="Submission metadata" icon={<DocIcon />}>
        <SList
          rows={[
            ['Contact name', dash(preview.metadata?.contactName)],
            ['Telephone number', dash(preview.metadata?.telephoneNumber)],
            ['Email address', dash(preview.metadata?.emailAddress)],
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Plan details" icon={<FolderIcon />}>
        <SList
          rows={[
            ['FSP ID', dash(preview.plan?.fspId)],
            ['Plan name', dash(preview.plan?.planName)],
            ['Amendment name', dash(preview.plan?.amendmentName)],
            ['Action', actionValue],
            ['Approval required', yesNo(preview.plan?.approvalRequired)],
            ['FRPA 197 election', yesNo(preview.plan?.frpa197)],
            ['Transitional FSP', yesNo(preview.plan?.transitional)],
            ['Legal doc consolidated', yesNo(preview.plan?.legalDocConsolidated)],
            ['FDU update', yesNo(preview.plan?.fduUpdate)],
            ['Stocking standards update', yesNo(preview.plan?.stockingStandardUpdate)],
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Term & dates" icon={<CalendarIcon />}>
        <SList
          rows={[
            ['Effective date', dash(preview.termAndDates?.planStartDate)],
            [
              'Term',
              formatTerm(preview.termAndDates?.planTermYears, preview.termAndDates?.planTermMonths),
            ],
            ['Expiry date', dash(preview.termAndDates?.planExpiryDate)],
            ...(preview.termAndDates?.amendmentComment
              ? ([['Amendment comment', preview.termAndDates.amendmentComment]] as Array<
                  [string, React.ReactNode]
                >)
              : []),
          ]}
        />
      </ReviewSection>

      <ReviewSection
        title={`Agreement holders (${preview.agreementHolders.length})`}
        icon={<LicenseIcon />}
      >
        {preview.agreementHolders.length === 0 ? (
          <p className="empty-state">No agreement holders declared.</p>
        ) : (
          <DTable
            ariaLabel="Agreement holders"
            headers={['Client #', 'Name']}
            rows={preview.agreementHolders.map((h) => [h.clientNumber, h.clientName ?? '—'])}
          />
        )}
      </ReviewSection>

      <ReviewSection title={`Districts (${preview.districts.length})`} icon={<AreaIcon />}>
        {preview.districts.length === 0 ? (
          <p className="empty-state">No districts declared.</p>
        ) : (
          <DTable
            ariaLabel="Districts"
            headers={['Code', 'Name']}
            rows={preview.districts.map((d) => [d.orgUnitCode, d.orgUnitName ?? '—'])}
          />
        )}
      </ReviewSection>

      <ReviewSection
        title={`Forest development units (${preview.fdus.length})`}
        icon={<TreeIcon />}
      >
        {preview.fdus.length === 0 ? (
          <p className="empty-state">No FDUs in this submission.</p>
        ) : (
          <DTable
            ariaLabel="Forest development units"
            headers={['Name', 'Licences', 'Polygons', 'SRS']}
            rows={preview.fdus.map((f) => [
              dash(f.name),
              String(f.licenceCount),
              String(f.polygonCount),
              dash(f.srsName),
            ])}
          />
        )}
      </ReviewSection>

      <ReviewSection
        title={`Stocking standards (${preview.stockingStandards.length})`}
        icon={<RegistryIcon />}
      >
        {preview.stockingStandards.length === 0 ? (
          <p className="empty-state">No new stocking standards regimes declared.</p>
        ) : (
          <DTable
            ariaLabel="Stocking standards"
            headers={['Standards ID', 'Standards name', 'Objective', 'BGC', 'Layers']}
            rows={preview.stockingStandards.map((s) => [
              dash(s.id),
              dash(s.name),
              dash(s.objective),
              s.bgcSummary
                ? s.bgcCount > 1
                  ? `${s.bgcSummary} (${s.bgcCount})`
                  : s.bgcSummary
                : '—',
              String(s.layerCount),
            ])}
          />
        )}
      </ReviewSection>
    </>
  );
}

// ── Confirmation screen (mockup s8-confirm) ───────────────────────

function ConfirmScreen({
  saved,
  type,
  onOpenDraft,
}: {
  saved: FspInformation;
  type: SubmissionType;
  onOpenDraft: (href: string) => void;
}) {
  const id = saved.fspId ?? '?';
  const name = saved.fspPlanName ?? '';
  const copy = SUBMISSION_COPY[type];
  const detailHref = saved.fspId
    ? `/fsp/information?fspId=${encodeURIComponent(saved.fspId)}`
    : null;
  return (
    <div className="screen">
      <div className="confirm-wrap" role="status" aria-live="polite" aria-atomic="true">
        <div className="confirm-icon" aria-hidden="true">
          <CheckIcon size={64} color="var(--fds-support-success)" />
        </div>
        <h2 className="confirm-title">{copy.confirmTitle}</h2>
        <p className="confirm-body">
          <strong>
            FSP {id}
            {name ? ` ${name}` : ''}
          </strong>{' '}
          {copy.confirmBody}
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          {detailHref && (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="open-draft-button"
              onClick={() => onOpenDraft(detailHref)}
            >
              {copy.confirmCta(String(id))}
              <DocumentIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function derivePreview(view: ViewState): SubmissionPreview | null {
  if (view.kind === 'validated') return view.result.preview;
  if (view.kind === 'submission' && view.outcome.kind === 'invalid') {
    return view.outcome.result.preview;
  }
  return null;
}

// ── Icons (inline SVG copied from the mockup) ─────────────────────

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true">
      <path d="M16 4L14.6 5.4 24.2 15 4 15 4 17 24.2 17 14.6 26.6 16 28 28 16 16 4z" />
    </svg>
  );
}

function SpinnerIcon({ color = '#fff' }: { color?: string }) {
  return (
    <svg className="spinner" viewBox="0 0 32 32" width="16" height="16" aria-hidden="true" style={{ fill: color }}>
      <path d="M16 4C9.4 4 4 9.4 4 16h2c0-5.5 4.5-10 10-10V4z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M25.7,9.3l-7-7A1,1,0,0,0,18,2H8A2,2,0,0,0,6,4V28a2,2,0,0,0,2,2H24a2,2,0,0,0,2-2V10A1,1,0,0,0,25.7,9.3ZM18,4.4,23.6,10H18ZM24,28H8V4h8v8h8Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M24 9.4L22.6 8 16 14.6 9.4 8 8 9.4 14.6 16 8 22.6 9.4 24 16 17.4 22.6 24 24 22.6 17.4 16 24 9.4z" />
    </svg>
  );
}

function ErrorIcon({ size = 14, color }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" style={color ? { fill: color } : undefined}>
      <path d="M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2zm-1 6h2v10h-2zm1 16a1.5 1.5 0 1 1 1.5-1.5A1.5 1.5 0 0 1 16 24z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2zm0 26a12 12 0 1 1 12-12 12 12 0 0 1-12 12zm-1-6h2v2h-2zm0-14h2v10h-2z" />
    </svg>
  );
}

function CheckIcon({ size, color }: { size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      width={size}
      height={size}
      style={color ? { fill: color } : undefined}
    >
      <path d="M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2zm-2 19.6-5.6-5.6 1.4-1.4 4.2 4.2 8.2-8.2 1.4 1.4z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true" style={{ fill: 'currentColor' }}>
      <path d="M26 24v4H6v-4H4v4a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2v-4zm-2-6-1.4-1.4L17 23.2V4h-2v19.2l-5.6-6.6L8 18l8 8 8-8z" />
    </svg>
  );
}

// Review-section heading icons (24×24, from the mockup)
function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.275 6.975L14.025 1.725C13.875 1.575 13.725 1.5 13.5 1.5H6C5.175 1.5 4.5 2.175 4.5 3V21C4.5 21.825 5.175 22.5 6 22.5H18C18.825 22.5 19.5 21.825 19.5 21V7.5C19.5 7.275 19.425 7.125 19.275 6.975ZM13.5 3.3L17.7 7.5H13.5V3.3ZM18 21H6V3H12V7.5C12 8.325 12.675 9 13.5 9H18V21Z" />
      <path d="M16.5 16.5H7.5V18H16.5V16.5Z" />
      <path d="M16.5 12H7.5V13.5H16.5V12Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.5 15H12V16.5H22.5V15Z" />
      <path d="M22.5 18H12V19.5H22.5V18Z" />
      <path d="M17.25 21H12V22.5H17.25V21Z" />
      <path d="M10.5 19.5H3V4.5H8.3775L10.9425 7.0575L11.3775 7.5H21V13.5H22.5V7.5C22.5 7.10218 22.342 6.72065 22.0607 6.43934C21.7794 6.15804 21.3978 6 21 6H12L9.4425 3.4425C9.30296 3.30212 9.13701 3.19075 8.95423 3.11481C8.77144 3.03886 8.57543 2.99984 8.3775 3H3C2.60218 3 2.22064 3.15804 1.93934 3.43934C1.65804 3.72064 1.5 4.10218 1.5 4.5V19.5C1.5 19.8978 1.65804 20.2794 1.93934 20.5607C2.22064 20.842 2.60218 21 3 21H10.5V19.5Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.5 3H16.5V1.5H15V3H9V1.5H7.5V3H4.5C3.675 3 3 3.675 3 4.5V19.5C3 20.325 3.675 21 4.5 21H19.5C20.325 21 21 20.325 21 19.5V4.5C21 3.675 20.325 3 19.5 3ZM19.5 19.5H4.5V9H19.5V19.5ZM19.5 7.5H4.5V4.5H7.5V6H9V4.5H15V6H16.5V4.5H19.5V7.5Z" />
    </svg>
  );
}

function LicenseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.5 10.5H6V12H10.5V10.5Z" />
      <path d="M15 4.5H6V6H15V4.5Z" />
      <path d="M15 7.5H6V9H15V7.5Z" />
      <path d="M10.5 18H6V19.5H10.5V18Z" />
      <path d="M20.25 18.75H15.75C15.1533 18.75 14.581 18.9871 14.159 19.409C13.7371 19.831 13.5 20.4033 13.5 21V22.5H15V21C15 20.8011 15.079 20.6103 15.2197 20.4697C15.3603 20.329 15.5511 20.25 15.75 20.25H20.25C20.4489 20.25 20.6397 20.329 20.7803 20.4697C20.921 20.6103 21 20.8011 21 21V22.5H22.5V21C22.5 20.4033 22.2629 19.831 21.841 19.409C21.419 18.9871 20.8467 18.75 20.25 18.75Z" />
      <path d="M18 18C18.5933 18 19.1734 17.8241 19.6667 17.4944C20.1601 17.1648 20.5446 16.6962 20.7716 16.1481C20.9987 15.5999 21.0581 14.9967 20.9424 14.4147C20.8266 13.8328 20.5409 13.2982 20.1213 12.8787C19.7018 12.4591 19.1672 12.1734 18.5853 12.0576C18.0033 11.9419 17.4001 12.0013 16.8519 12.2284C16.3038 12.4554 15.8352 12.8399 15.5056 13.3333C15.1759 13.8266 15 14.4067 15 15C15 15.7956 15.3161 16.5587 15.8787 17.1213C16.4413 17.6839 17.2044 18 18 18ZM18 13.5C18.2967 13.5 18.5867 13.588 18.8334 13.7528C19.08 13.9176 19.2723 14.1519 19.3858 14.426C19.4994 14.7001 19.5291 15.0017 19.4712 15.2926C19.4133 15.5836 19.2704 15.8509 19.0607 16.0607C18.8509 16.2704 18.5836 16.4133 18.2926 16.4712C18.0017 16.5291 17.7001 16.4994 17.426 16.3858C17.1519 16.2723 16.9176 16.08 16.7528 15.8334C16.588 15.5867 16.5 15.2967 16.5 15C16.5 14.6022 16.658 14.2206 16.9393 13.9393C17.2206 13.658 17.6022 13.5 18 13.5Z" />
      <path d="M10.5 22.5H4.5C4.1023 22.4996 3.72101 22.3414 3.4398 22.0602C3.15859 21.779 3.00042 21.3977 3 21V3C3.00042 2.6023 3.15859 2.22101 3.4398 1.9398C3.72101 1.65859 4.1023 1.50042 4.5 1.5H16.5C16.8977 1.50042 17.279 1.65859 17.5602 1.9398C17.8414 2.22101 17.9996 2.6023 18 3V10.5H16.5V3H4.5V21H10.5V22.5Z" />
    </svg>
  );
}

function AreaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.2501 16.6064V7.39345C20.7618 7.26224 21.2296 6.99797 21.6061 6.62748C21.9827 6.25699 22.2545 5.79347 22.3939 5.28397C22.5334 4.77447 22.5356 4.23715 22.4002 3.72654C22.2649 3.21594 21.9968 2.75023 21.6233 2.37671C21.2498 2.00319 20.7841 1.73515 20.2735 1.59981C19.7629 1.46447 19.2255 1.46664 18.7161 1.6061C18.2066 1.74557 17.743 2.01736 17.3725 2.39389C17.0021 2.77041 16.7378 3.23827 16.6066 3.74995H7.39357C7.26236 3.23827 6.99809 2.77041 6.6276 2.39389C6.25711 2.01736 5.79359 1.74557 5.28409 1.6061C4.7746 1.46664 4.23727 1.46447 3.72666 1.59981C3.21606 1.73515 2.75036 2.00319 2.37683 2.37671C2.00331 2.75023 1.73527 3.21594 1.59993 3.72654C1.46459 4.23715 1.46676 4.77447 1.60622 5.28397C1.74569 5.79347 2.01748 6.25699 2.39401 6.62748C2.77054 6.99797 3.23839 7.26224 3.75007 7.39345V16.6064C3.23839 16.7377 2.77054 17.0019 2.39401 17.3724C2.01748 17.7429 1.74569 18.2064 1.60622 18.7159C1.46676 19.2254 1.46459 19.7628 1.59993 20.2734C1.73527 20.784 2.00331 21.2497 2.37683 21.6232C2.75036 21.9967 3.21606 22.2647 3.72666 22.4001C4.23727 22.5354 4.7746 22.5333 5.28409 22.3938C5.79359 22.2543 6.25711 21.9825 6.6276 21.606C6.99809 21.2295 7.26236 20.7616 7.39357 20.25H16.6066C16.7378 20.7616 17.0021 21.2295 17.3725 21.606C17.743 21.9825 18.2066 22.2543 18.7161 22.3938C19.2255 22.5333 19.7629 22.5354 20.2735 22.4001C20.7841 22.2647 21.2498 21.9967 21.6233 21.6232C21.9968 21.2497 22.2649 20.784 22.4002 20.2734C22.5356 19.7628 22.5334 19.2254 22.3939 18.7159C22.2545 18.2064 21.9827 17.7429 21.6061 17.3724C21.2296 17.0019 20.7618 16.7377 20.2501 16.6064Z" />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 22.5H6.75V21H9V11.6748L6.36405 10.0931L7.13595 8.80702L9.77197 10.3883C9.99351 10.5223 10.1768 10.711 10.3043 10.9363C10.4318 11.1616 10.4992 11.4159 10.5 11.6748V21C10.4995 21.3977 10.3414 21.7789 10.0602 22.0602C9.77895 22.3414 9.39768 22.4995 9 22.5Z" />
      <path d="M16.5 22.5H14.25C13.8523 22.4995 13.4711 22.3413 13.1899 22.0601C12.9087 21.7789 12.7505 21.3977 12.75 21V12.75H17.25C17.669 12.75 18.0834 12.6622 18.4664 12.4923C18.8495 12.3224 19.1927 12.0742 19.474 11.7636C19.7552 11.453 19.9683 11.0869 20.0995 10.689C20.2307 10.291 20.2771 9.86998 20.2358 9.453C20.1354 8.69435 19.759 7.99928 19.1785 7.50064C18.598 7.002 17.8541 6.73476 17.089 6.75H15.9012L15.7687 6.16575C15.339 4.27207 13.5231 3 11.25 3C10.3916 3.00273 9.55172 3.25013 8.82889 3.71318C8.10606 4.17623 7.53022 4.83576 7.16888 5.61442L6.9375 6.11483L6.29025 6.0291C6.1943 6.01261 6.09731 6.00289 6 6C5.20435 6 4.44129 6.31607 3.87868 6.87868C3.31607 7.44129 3 8.20435 3 9C3 9.79565 3.31607 10.5587 3.87868 11.1213C4.44129 11.6839 5.20435 12 6 12V13.5C4.80653 13.5 3.66193 13.0259 2.81802 12.182C1.97411 11.3381 1.5 10.1935 1.5 9C1.5 7.80653 1.97411 6.66193 2.81802 5.81802C3.66193 4.97411 4.80653 4.5 6 4.5C6.0198 4.5 6.03937 4.5 6.05895 4.50075C6.5866 3.59062 7.34353 2.83465 8.25433 2.30815C9.16512 1.78166 10.198 1.50302 11.25 1.5C14.0091 1.5 16.2692 2.9832 17.0637 5.25H17.089C18.2266 5.23729 19.3289 5.64448 20.185 6.39365C21.0412 7.14282 21.591 8.18137 21.7294 9.31057C21.7906 9.93563 21.7203 10.5666 21.523 11.1628C21.3258 11.7591 21.0059 12.3075 20.584 12.7727C20.1621 13.2379 19.6475 13.6097 19.0733 13.8641C18.4991 14.1186 17.878 14.25 17.25 14.25H14.25V21H16.5V22.5Z" />
    </svg>
  );
}

function RegistryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 22.5H17.25C16.8523 22.4995 16.471 22.3414 16.1898 22.0602C15.9086 21.7789 15.7505 21.3977 15.75 21V17.25C15.7505 16.8523 15.9086 16.471 16.1898 16.1898C16.471 15.9086 16.8523 15.7505 17.25 15.75H21C21.3977 15.7505 21.7789 15.9086 22.0602 16.1898C22.3414 16.471 22.4995 16.8523 22.5 17.25V21C22.4995 21.3977 22.3414 21.7789 22.0602 22.0602C21.7789 22.3414 21.3977 22.4995 21 22.5ZM17.2491 17.25L17.25 21H21V17.25H17.2491Z" />
      <path d="M12 17.25H8.25C7.85232 17.2495 7.47105 17.0914 7.18984 16.8102C6.90864 16.529 6.75046 16.1477 6.75 15.75V8.25C6.75046 7.85232 6.90864 7.47105 7.18984 7.18984C7.47105 6.90864 7.85232 6.75046 8.25 6.75H15.75C16.1477 6.75046 16.529 6.90864 16.8102 7.18984C17.0914 7.47105 17.2495 7.85232 17.25 8.25V12H15.75V8.25H8.25V15.75H12V17.25Z" />
      <path d="M12 22.5H3C2.60232 22.4995 2.22105 22.3414 1.93984 22.0602C1.65864 21.7789 1.50046 21.3977 1.5 21V3C1.50046 2.60232 1.65864 2.22105 1.93984 1.93984C2.22105 1.65864 2.60232 1.50046 3 1.5H21C21.3977 1.50046 21.7789 1.65864 22.0602 1.93984C22.3414 2.22105 22.4995 2.60232 22.5 3V12H21V3H3V21H12V22.5Z" />
    </svg>
  );
}
