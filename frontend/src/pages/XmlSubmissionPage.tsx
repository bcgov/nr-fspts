import {useMemo, useRef, useState} from 'react';
import {
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
  Tile,
} from '@carbon/react';
import {Upload} from '@carbon/react/icons';
import {Link as RouterLink} from 'react-router-dom';

import {useNotification} from '@/context/notification/useNotification';
import {
  type SubmissionOutcome,
  type SubmissionValidationError,
  type SubmissionValidationResult,
  submitSubmission,
  validateSubmission,
} from '@/services/fspSubmissions';
import './XmlSubmissionPage.scss';

type ViewState =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'validation'; result: SubmissionValidationResult }
  | { kind: 'submission'; outcome: SubmissionOutcome };

const MAX_BYTES = 50 * 1024 * 1024;

export default function XmlSubmissionPage() {
  const { display } = useNotification();
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [view, setView] = useState<ViewState>({ kind: 'idle' });
  // FileUploader's content is uncontrolled — we hold a key so the
  // "Clear" button can force a remount and wipe the picker.
  const [resetKey, setResetKey] = useState(0);
  const formRef = useRef<HTMLDivElement | null>(null);

  const canSubmit = xmlFile != null && view.kind !== 'busy';

  const validateSize = (file: File): string | null => {
    if (file.size > MAX_BYTES) {
      return `File exceeds the 50 MB upload cap (${(file.size / 1_048_576).toFixed(1)} MB)`;
    }
    return null;
  };

  // Carbon's FileUploader.onChange signature is
  //   (event: SyntheticEvent<HTMLElement>, data?: FileChangeData)
  // — the event's target is the wrapper <span>, NOT the underlying
  // <input>, so event.target.files is undefined. The actual File objects
  // are inside data.addedFiles[i].file. Older Carbon versions don't pass
  // the second arg at all; fall back to the input's files via
  // currentTarget when needed.
  const filesFromCarbon = (
    event: React.SyntheticEvent<HTMLElement>,
    data?: { addedFiles?: Array<{ file: File }> },
  ): File[] => {
    if (data?.addedFiles?.length) {
      return data.addedFiles.map((f) => f.file).filter(Boolean);
    }
    const input = event.currentTarget as unknown as HTMLInputElement;
    if (input?.files?.length) {
      return Array.from(input.files);
    }
    const target = event.target as unknown as HTMLInputElement;
    if (target?.files?.length) {
      return Array.from(target.files);
    }
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

  const handleValidate = async () => {
    if (!xmlFile || xmlFile.size === 0) {
      display({
        kind: 'error',
        title: 'No file selected',
        subtitle: 'Pick an XML file before validating.',
        timeout: 6000,
      });
      return;
    }
    setView({ kind: 'busy', label: 'Validating…' });
    try {
      const result = await validateSubmission(xmlFile);
      setView({ kind: 'validation', result });
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      setView({ kind: 'idle' });
      display({
        kind: 'error',
        title: 'Validation failed',
        subtitle: err instanceof Error ? err.message : 'Unknown error',
        timeout: 6000,
      });
    }
  };

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
    setView({ kind: 'busy', label: 'Submitting…' });
    try {
      const outcome = await submitSubmission(xmlFile, attachments);
      setView({ kind: 'submission', outcome });
      if (outcome.kind === 'created') {
        display({
          kind: 'success',
          title: 'Submission accepted',
          subtitle: `FSP ${outcome.saved.fspId ?? ''} amendment ${
            outcome.saved.fspAmendmentNumber ?? ''
          } saved.`,
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
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  const resultPanel = useMemo(() => renderResult(view), [view]);

  return (
    <Grid fullWidth className="default-grid fsp-submit-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-submit__header">
          <h1>Data Submission</h1>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <Tile className="fsp-submit__tile">
          <div ref={formRef} className="fsp-submit__form">
            <div className="fsp-submit__section">
              <h2 className="fsp-submit__section-title">Upload FSP Submission</h2>
              <p className="fsp-submit__section-help">
                Upload the FSP submission XML (either the bare{' '}
                <code>&lt;fsp:fspSubmission&gt;</code> document or the legacy{' '}
                <code>&lt;esf:ESFSubmission&gt;</code> envelope). The backend strips
                the envelope, validates schema and geometry, and persists the FSP,
                FDUs, identified areas, stocking standards, and attachments in a
                single transaction.
              </p>
              <FileUploader
                key={`xml-${resetKey}`}
                labelTitle="Submission XML"
                labelDescription="Required. Accepted format: .xml. Max size: 50 MB."
                buttonLabel="Choose file"
                accept={['.xml']}
                multiple={false}
                filenameStatus="edit"
                onChange={onXmlChange}
                onDelete={() => setXmlFile(null)}
              />
            </div>

            <div className="fsp-submit__section">
              <h2 className="fsp-submit__section-title">Attachments (optional)</h2>
              <p className="fsp-submit__section-help">
                Optional supporting files (maps, FSP document, amendment description,
                etc.). All uploads default to the “Supporting Documents” category for
                now; fine-grained categorization will land in a follow-up.
              </p>
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
            </div>

            <div className="fsp-submit__actions">
              <Button
                kind="primary"
                renderIcon={Upload}
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                Submit
              </Button>
              <Button kind="tertiary" disabled={!canSubmit} onClick={handleValidate}>
                Validate only
              </Button>
              <Button kind="ghost" onClick={onClear}>
                Clear
              </Button>
            </div>

            {view.kind === 'busy' && (
              <div className="fsp-submit__busy">
                <InlineLoading description={view.label} status="active" />
              </div>
            )}

            {resultPanel && <div className="fsp-submit__result">{resultPanel}</div>}
          </div>
        </Tile>
      </Column>
    </Grid>
  );
}

function renderResult(view: ViewState): React.ReactNode {
  if (view.kind === 'idle' || view.kind === 'busy') return null;

  if (view.kind === 'validation') {
    return renderValidationResult(view.result, /*isPersist=*/ false);
  }

  if (view.kind === 'submission') {
    const outcome = view.outcome;
    if (outcome.kind === 'created') {
      const id = outcome.saved.fspId ?? '?';
      const amendment = outcome.saved.fspAmendmentNumber ?? '?';
      const name = outcome.saved.fspPlanName ?? '';
      const detailHref =
        outcome.saved.fspId != null
          ? `/fsp/information?fspId=${encodeURIComponent(outcome.saved.fspId)}${
              outcome.saved.fspAmendmentNumber != null
                ? `&amendmentNumber=${encodeURIComponent(outcome.saved.fspAmendmentNumber)}`
                : ''
            }`
          : null;
      return (
        <Stack gap={3}>
          <InlineNotification
            kind="success"
            lowContrast
            hideCloseButton
            title={`FSP ${id} amendment ${amendment} saved`}
            subtitle={name || undefined}
          />
          {detailHref && (
            <div className="fsp-submit__detail-link">
              <RouterLink to={detailHref}>Open FSP details →</RouterLink>
            </div>
          )}
        </Stack>
      );
    }
    if (outcome.kind === 'invalid') {
      return renderValidationResult(outcome.result, /*isPersist=*/ true);
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

  return null;
}

function renderValidationResult(
  result: SubmissionValidationResult,
  isPersist: boolean,
): React.ReactNode {
  if (result.valid) {
    return (
      <InlineNotification
        kind="success"
        lowContrast
        hideCloseButton
        title={isPersist ? 'Submission persisted' : 'XML is valid'}
        subtitle={
          isPersist
            ? 'Persisted to FSP_300 + spatial + standards + attachments.'
            : 'Schema and geometry validation passed. Click Submit to persist.'
        }
      />
    );
  }
  return (
    <Stack gap={4}>
      <InlineNotification
        kind={isPersist ? 'error' : 'warning'}
        lowContrast
        hideCloseButton
        title={
          isPersist
            ? 'Submission rejected — validation errors'
            : `${result.errors.length} validation issue${
                result.errors.length === 1 ? '' : 's'
              } found`
        }
        subtitle={
          isPersist
            ? 'No data was persisted. Fix the issues below and resubmit.'
            : 'These would block a Submit. Fix the XML and re-validate.'
        }
      />
      <ErrorTable errors={result.errors} />
    </Stack>
  );
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
