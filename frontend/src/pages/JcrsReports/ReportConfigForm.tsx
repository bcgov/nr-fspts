import {
  Button,
  ComboBox,
  DatePicker,
  DatePickerInput,
  Loading,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@carbon/react';
import { Download, Launch } from '@carbon/icons-react';
import {
  useEffect,
  useState,
  type ChangeEvent,
  type FC,
  type FormEvent,
  type ReactNode,
} from 'react';

import { useNotification } from '@/context/notification/useNotification';
import {
  searchClientsAuto,
  type ClientSearchResult,
} from '@/services/clientSearch';
import { type CodeOption } from '@/services/fspSearch';
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

// Inline validation messages for the required fields — surfaced under the
// field (red border + text), not as a toast, matching the report mocks.
interface FieldErrors {
  orgUnitNo?: string;
  fspId?: string;
}

// "Name (ACR) · 00012345" label for an agreement-holder search result —
// same rendering the FSP Search page uses so the two autocompletes match.
const clientLabel = (c: ClientSearchResult): string => {
  const parts: string[] = [];
  const name = c.clientName?.trim();
  if (name) parts.push(name);
  const acronym = c.clientAcronym?.trim();
  if (acronym) parts.push(`(${acronym})`);
  const number = c.clientNumber?.trim();
  const label = parts.join(' ');
  if (number) return label ? `${label} · ${number}` : number;
  return label;
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
  const [errors, setErrors] = useState<FieldErrors>({});
  // Output format is now a radio choice; the single action button's label +
  // icon + behaviour derive from it (Generate PDF ⧉ / Download CSV ⭳).
  const [format, setFormat] = useState<FspReportFormat>(
    definition.availableFormats[0] ?? 'pdf',
  );

  // Agreement-holder autocomplete state (mirrors SearchPage): the typed term,
  // the fetched suggestions, and the picked client. formState.ahClientNumber
  // holds the resolved client *number* — the actual report filter.
  const [holderTerm, setHolderTerm] = useState('');
  const [holderItems, setHolderItems] = useState<ClientSearchResult[]>([]);
  const [holderSelected, setHolderSelected] =
    useState<ClientSearchResult | null>(null);

  // Re-blank the form whenever the definition changes (user closed and
  // reopened a different accordion row).
  useEffect(() => {
    setFormState(BLANK_STATE);
    setErrors({});
    setFormat(definition.availableFormats[0] ?? 'pdf');
    setHolderTerm('');
    setHolderItems([]);
    setHolderSelected(null);
  }, [definition.id, definition.availableFormats]);

  // Debounced agreement-holder lookup — wait 300ms, skip terms under 3 chars,
  // tolerate a failed fetch by clearing the list.
  useEffect(() => {
    const term = holderTerm.trim();
    if (term.length < 3) {
      setHolderItems([]);
      return;
    }
    const handle = setTimeout(() => {
      searchClientsAuto(term)
        .then(setHolderItems)
        .catch(() => setHolderItems([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [holderTerm]);

  // Typing replaces any prior selection and clears the holder filter until a
  // new client is picked. Ignore the synthetic input change Carbon fires when
  // it sets the input to the selected item's label.
  const handleHolderInput = (text: string) => {
    if (holderSelected && clientLabel(holderSelected) === text) return;
    setHolderSelected(null);
    setFormState((prev) =>
      prev.ahClientNumber ? { ...prev, ahClientNumber: '' } : prev,
    );
    setHolderTerm(text);
  };

  const handleHolderSelect = (data: {
    selectedItem?: ClientSearchResult | null;
  }) => {
    const client = data.selectedItem ?? null;
    setHolderSelected(client);
    setFormState((prev) => ({
      ...prev,
      ahClientNumber: client?.clientNumber?.trim() ?? '',
    }));
  };

  const handleSelectChange =
    (field: keyof ReportFormState) => (event: ChangeEvent<HTMLSelectElement>) => {
      setFormState((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  const handleTextChange =
    (field: keyof ReportFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, [field]: event.target.value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  const generate = async (fmt: FspReportFormat) => {
    // Required-field guards render inline under the field (red border +
    // message), mirroring the mock — no toast for these.
    const nextErrors: FieldErrors = {};
    if (definition.fields.fspId === 'required' && !formState.fspId.trim()) {
      nextErrors.fspId = 'Enter an FSP ID to run this report.';
    }
    if (definition.fields.orgUnit === 'required' && !formState.orgUnitNo.trim()) {
      nextErrors.orgUnitNo = 'Select an organization unit to run this report.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
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
      const payload = sanitizePayload(formState, definition, fmt);
      const response = await requestReport(definition.id, payload);
      if (fmt === 'pdf') {
        openBlobInNewTab(response.blob);
      } else {
        triggerBrowserDownload(response.blob, response.filename);
      }
      // No success toast — the report opening in a new tab / starting a
      // browser download IS the success affordance.
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
    void generate(format);
  };

  const handleReset = () => {
    setFormState(BLANK_STATE);
    setErrors({});
    setFormat(definition.availableFormats[0] ?? 'pdf');
    setHolderTerm('');
    setHolderItems([]);
    setHolderSelected(null);
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
              labelText="Date from"
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
              labelText="Date to"
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
                ? 'Organization unit (required)'
                : 'Organization unit'
            }
            value={formState.orgUnitNo}
            onChange={handleSelectChange('orgUnitNo')}
            disabled={orgUnitsLoading}
            invalid={!!errors.orgUnitNo}
            invalidText={errors.orgUnitNo}
          >
            <SelectItem value="" text="Select an organization unit" />
            {orgUnits.map((o) => (
              <SelectItem key={o.code} value={o.code} text={o.description} />
            ))}
          </Select>,
        ];
      case 'ahClientNumber':
        if (!definition.fields.ahClientNumber) return null;
        return [
          <ComboBox
            key="ahClientNumber"
            id={`report-${definition.id}-ahClientNumber`}
            titleText="Agreement holder"
            helperText="Enter name, acronym, or client number (min. 3 characters)"
            placeholder=""
            items={holderItems}
            itemToString={(item) => (item ? clientLabel(item) : '')}
            selectedItem={holderSelected}
            onInputChange={handleHolderInput}
            onChange={handleHolderSelect}
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
            invalid={!!errors.fspId}
            invalidText={errors.fspId}
          />,
        ];
      default:
        return null;
    }
  };

  // Default layout: each known field on its own row. Per-report `layout`
  // overrides this to pack multiple fields per row.
  const layout = definition.layout ?? [
    ['dateRange'],
    ['orgUnit'],
    ['ahClientNumber'],
    ['fspId'],
  ];

  const actionLabel = generating
    ? format === 'pdf'
      ? 'Generating PDF report'
      : 'Downloading CSV report'
    : format === 'pdf'
      ? 'Generate PDF report'
      : 'Download CSV report';

  return (
    <form className="report-form" onSubmit={handleSubmit}>
      <p className="report-form__hint">
        All fields optional unless marked required.
      </p>
      <Stack gap={6}>
        {layout.map((row, rowIndex) => {
          const cells = row.flatMap((key) => {
            const elements = renderField(key);
            if (!elements) return [];
            return elements.map((element, i) => (
              <div
                key={`${key}-${i}`}
                className={`report-form__field report-form__field--${key}`}
              >
                {element}
              </div>
            ));
          });
          if (cells.length === 0) return null;
          return (
            <div key={rowIndex} className="report-form__field-group">
              {cells}
            </div>
          );
        })}

        {(supportsPdf || supportsCsv) && (
          <RadioButtonGroup
            className="report-form__format"
            legendText="Format"
            name={`report-${definition.id}-format`}
            valueSelected={format}
            onChange={(value) => setFormat(value as FspReportFormat)}
          >
            {supportsPdf && (
              <RadioButton
                id={`report-${definition.id}-fmt-pdf`}
                labelText="PDF"
                value="pdf"
              />
            )}
            {supportsCsv && (
              <RadioButton
                id={`report-${definition.id}-fmt-csv`}
                labelText="CSV"
                value="csv"
              />
            )}
          </RadioButtonGroup>
        )}

        <div className="report-form__actions">
          <Button
            kind="tertiary"
            size="md"
            type="button"
            onClick={handleReset}
            disabled={generating}
          >
            Clear all
          </Button>
          <Button
            kind="primary"
            size="md"
            type="button"
            onClick={() => void generate(format)}
            disabled={generating}
            renderIcon={
              generating ? undefined : format === 'pdf' ? Launch : Download
            }
          >
            {generating ? (
              <span className="report-form__generating">
                <span>{actionLabel}</span>
                <Loading small withOverlay={false} description="Working" />
              </span>
            ) : (
              actionLabel
            )}
          </Button>
        </div>
      </Stack>
    </form>
  );
};

export default ReportConfigForm;
