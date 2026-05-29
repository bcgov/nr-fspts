import {
  Button,
  DatePicker,
  DatePickerInput,
  Loading,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@carbon/react';
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FC,
  type FormEvent,
  type ReactNode,
} from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { getOrgUnits, type CodeOption } from '@/services/fspSearch';
import {
  requestReport,
  type FspReportFormat,
  type FspReportRequestPayload,
} from '@/services/reports';
import { openBlobInNewTab, triggerBrowserDownload } from '@/utils/download';

import type { ReportDefinition, ReportFieldKey } from './reportDefinitions';

interface ReportFormState {
  startDate: string;
  endDate: string;
  orgUnitNo: string;
  ahClientNumber: string;
  fspId: string;
}

const BLANK_STATE: ReportFormState = {
  startDate: '',
  endDate: '',
  orgUnitNo: '',
  ahClientNumber: '',
  fspId: '',
};

const sanitizePayload = (
  state: ReportFormState,
  definition: ReportDefinition,
  format: FspReportFormat,
): FspReportRequestPayload => {
  const payload: FspReportRequestPayload = { format };

  const assignString = (key: keyof FspReportRequestPayload, value: string) => {
    if (value && value.trim().length > 0) {
      (payload as Record<string, unknown>)[key as string] = value.trim();
    }
  };

  if (definition.fields.dateRange) {
    assignString('startDate', state.startDate);
    assignString('endDate', state.endDate);
  }
  if (definition.fields.orgUnit) {
    assignString('orgUnitNo', state.orgUnitNo);
  }
  if (definition.fields.ahClientNumber) {
    assignString('ahClientNumber', state.ahClientNumber);
  }
  if (definition.fields.fspId) {
    assignString('fspId', state.fspId);
  }

  return payload;
};

export interface ReportConfigFormProps {
  definition: ReportDefinition;
  orgUnits: CodeOption[];
  orgUnitsLoading: boolean;
}

const ReportConfigForm: FC<ReportConfigFormProps> = ({
  definition,
  orgUnits,
  orgUnitsLoading,
}) => {
  const { display } = useNotification();
  const [formState, setFormState] = useState<ReportFormState>(BLANK_STATE);
  const [generating, setGenerating] = useState(false);

  // Re-blank the form whenever the definition changes (i.e. user
  // closed and reopened a different accordion row).
  useEffect(() => {
    setFormState(BLANK_STATE);
  }, [definition.id]);

  const handleSelectChange =
    (field: keyof ReportFormState) => (event: ChangeEvent<HTMLSelectElement>) => {
      setFormState((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleTextChange =
    (field: keyof ReportFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const generate = async (format: FspReportFormat) => {
    // Required-field guards (client-side mirror of the backend
    // validation — keeps users out of an obviously-bad round trip).
    if (definition.fields.fspId === 'required' && !formState.fspId.trim()) {
      display({
        kind: 'warning',
        title: 'FSP ID required',
        subtitle: 'Enter an FSP ID before generating this report.',
        timeout: 5000,
      });
      return;
    }
    if (definition.fields.orgUnit === 'required' && !formState.orgUnitNo.trim()) {
      display({
        kind: 'warning',
        title: 'Organization unit required',
        subtitle: 'Pick an org unit before generating this report.',
        timeout: 5000,
      });
      return;
    }
    if (
      formState.startDate &&
      formState.endDate &&
      formState.startDate > formState.endDate
    ) {
      display({
        kind: 'warning',
        title: 'Invalid date range',
        subtitle: 'Date From must be on or before Date To.',
        timeout: 5000,
      });
      return;
    }

    setGenerating(true);
    try {
      const payload = sanitizePayload(formState, definition, format);
      const response = await requestReport(definition.id, payload);
      if (format === 'pdf') {
        openBlobInNewTab(response.blob);
      } else {
        triggerBrowserDownload(response.blob, response.filename);
      }
      display({
        kind: 'success',
        title: `${definition.title} ready`,
        subtitle: response.filename,
        timeout: 5000,
      });
    } catch (error) {
      display({
        kind: 'error',
        title: `Unable to generate ${definition.title}`,
        subtitle: (error as Error).message ?? 'An unexpected error occurred',
        timeout: 9000,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void generate(definition.availableFormats[0] ?? 'pdf');
  };

  const handleReset = () => {
    setFormState(BLANK_STATE);
  };

  const supportsPdf = definition.availableFormats.includes('pdf');
  const supportsCsv = definition.availableFormats.includes('csv');

  const renderField = (key: ReportFieldKey): ReactNode[] | null => {
    switch (key) {
      case 'dateRange':
        if (!definition.fields.dateRange) return null;
        return [
          <DatePicker
            key="start-date"
            datePickerType="single"
            dateFormat="Y-m-d"
            value={formState.startDate}
            onChange={(dates: Date[]) => {
              const date = dates[0];
              setFormState((prev) => ({
                ...prev,
                startDate: date ? date.toISOString().split('T')[0] : '',
              }));
            }}
          >
            <DatePickerInput
              id={`report-${definition.id}-start-date`}
              labelText="Date From"
              placeholder="YYYY-MM-DD"
              pattern="\d{4}-\d{2}-\d{2}"
            />
          </DatePicker>,
          <DatePicker
            key="end-date"
            datePickerType="single"
            dateFormat="Y-m-d"
            value={formState.endDate}
            onChange={(dates: Date[]) => {
              const date = dates[0];
              setFormState((prev) => ({
                ...prev,
                endDate: date ? date.toISOString().split('T')[0] : '',
              }));
            }}
          >
            <DatePickerInput
              id={`report-${definition.id}-end-date`}
              labelText="Date To"
              placeholder="YYYY-MM-DD"
              pattern="\d{4}-\d{2}-\d{2}"
            />
          </DatePicker>,
        ];
      case 'orgUnit':
        if (!definition.fields.orgUnit) return null;
        return [
          <Select
            key="orgUnit"
            id={`report-${definition.id}-orgUnit`}
            labelText={
              definition.fields.orgUnit === 'required'
                ? 'Organization Unit (required)'
                : 'Organization Unit'
            }
            value={formState.orgUnitNo}
            onChange={handleSelectChange('orgUnitNo')}
            disabled={orgUnitsLoading}
          >
            <SelectItem
              value=""
              text={
                definition.fields.orgUnit === 'required'
                  ? 'Select an organization unit'
                  : 'All organization units'
              }
            />
            {orgUnits.map((o) => (
              <SelectItem key={o.code} value={o.code} text={o.description} />
            ))}
          </Select>,
        ];
      case 'ahClientNumber':
        if (!definition.fields.ahClientNumber) return null;
        return [
          <TextInput
            key="ahClientNumber"
            id={`report-${definition.id}-ahClientNumber`}
            labelText="Agreement Holder Client #"
            value={formState.ahClientNumber}
            onChange={handleTextChange('ahClientNumber')}
            maxLength={8}
          />,
        ];
      case 'fspId':
        if (!definition.fields.fspId) return null;
        return [
          <TextInput
            key="fspId"
            id={`report-${definition.id}-fspId`}
            labelText={
              definition.fields.fspId === 'required' ? 'FSP ID (required)' : 'FSP ID'
            }
            value={formState.fspId}
            onChange={handleTextChange('fspId')}
            maxLength={10}
          />,
        ];
      default:
        return null;
    }
  };

  // Default layout: each known field on its own row. Per-report
  // `layout` overrides this to pack multiple fields per row.
  const layout = definition.layout ?? [
    ['dateRange'],
    ['orgUnit'],
    ['ahClientNumber'],
    ['fspId'],
  ];

  return (
    <form className="report-form" onSubmit={handleSubmit}>
      <Stack gap={5}>
        {layout.map((row, rowIndex) => {
          const elements = row.flatMap((key) => renderField(key) ?? []);
          if (elements.length === 0) return null;
          return (
            <div key={rowIndex} className="report-form__field-group">
              {elements}
            </div>
          );
        })}

        <div className="report-form__actions">
          <Button
            kind="tertiary"
            size="md"
            type="button"
            onClick={handleReset}
            disabled={generating}
          >
            Reset
          </Button>
          {supportsCsv && (
            <Button
              kind="secondary"
              size="md"
              type="button"
              onClick={() => void generate('csv')}
              disabled={generating}
            >
              Export CSV
            </Button>
          )}
          {supportsPdf && (
            <Button
              kind="primary"
              size="md"
              type="button"
              onClick={() => void generate('pdf')}
              disabled={generating}
            >
              {generating ? (
                <span className="report-form__generating">
                  <Loading small withOverlay={false} description="Generating" />
                  <span>Generating…</span>
                </span>
              ) : (
                'Generate PDF'
              )}
            </Button>
          )}
        </div>
      </Stack>
    </form>
  );
};

export default ReportConfigForm;
