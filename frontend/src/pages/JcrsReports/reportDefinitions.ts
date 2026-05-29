import type { FspReportFormat, FspReportId } from '@/services/reports';

export type ReportFieldKey =
  | 'dateRange'
  | 'orgUnit'
  | 'ahClientNumber'
  | 'fspId';

export interface ReportDefinition {
  id: FspReportId;
  title: string;
  summary: string;
  availableFormats: FspReportFormat[];
  fields: {
    dateRange?: boolean;
    // For required fields, the form labels the input with "(required)"
    // and rejects submission via the toast when blank. `true` is the
    // default-rendered shorthand for `'optional'`.
    orgUnit?: boolean | 'optional' | 'required';
    ahClientNumber?: boolean;
    fspId?: boolean | 'optional' | 'required';
  };
  /**
   * Ordered rows of fields. Each inner array becomes a 3-column row
   * inside the report's accordion panel. Fields not listed here still
   * render — they fall back to one-per-row in the order declared.
   */
  layout?: ReportFieldKey[][];
}

/**
 * Source of truth for the reports table on /reports/jcrs. Adding a
 * new report = append an entry here + register the matching
 * FspReportDefinition on the backend.
 */
export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'fsp-summary',
    title: 'FSP Summary Report',
    summary:
      'Summary listing of FSPs filtered by org unit, agreement holder, and effective-date range. Org unit is required — the proc returns no rows without one.',
    availableFormats: ['pdf', 'csv'],
    fields: {
      dateRange: true,
      // Org unit is required: leaving it blank returns no rows (the
      // proc filters on the value strictly), so guard up-front
      // rather than producing an empty PDF.
      orgUnit: 'required',
      ahClientNumber: true,
      fspId: 'optional',
    },
    layout: [['orgUnit', 'ahClientNumber', 'fspId'], ['dateRange']],
  },
  {
    id: 'fsp-stocking-standards',
    title: 'FSP Stocking Standards Report',
    summary:
      'Stocking standards for a single FSP. FSP ID is required; other filters narrow within that plan.',
    availableFormats: ['pdf', 'csv'],
    fields: {
      orgUnit: true,
      ahClientNumber: true,
      fspId: 'required',
    },
    layout: [['fspId', 'orgUnit', 'ahClientNumber']],
  },
];
