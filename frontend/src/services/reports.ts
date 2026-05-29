import { fetchAuthSession } from 'aws-amplify/auth';

import { env } from '@/env';
import { ensureSessionFresh } from '@/context/auth/refreshSession';

/**
 * Report service — POSTs a JSON request to the backend and returns
 * the rendered file as a Blob (along with the server-supplied
 * filename pulled out of Content-Disposition).
 *
 * Mirrors nr-rept's services/reports/api.ts pattern: same response
 * shape, same Content-Disposition parsing, same Bearer-token-via-FAM
 * auth. Where REPT uses its buildAuthorizedHeaders helper, we go
 * straight through Amplify since FSP's apiFetch already does the
 * session-fresh check + token attach for normal requests; the report
 * endpoint returns binary so we can't reuse apiFetch (which
 * pre-supposes a JSON response).
 */

const API_BASE_URL = env.VITE_API_BASE_URL ?? '';

export type FspReportId = 'fsp-summary' | 'fsp-stocking-standards';
export type FspReportFormat = 'pdf' | 'csv';

export interface FspReportRequestPayload {
  startDate?: string | null;
  endDate?: string | null;
  orgUnitNo?: string | null;
  fspStatusCode?: string | null;
  ahClientNumber?: string | null;
  fspId?: string | null;
  sortColumn?: string | null;
  format?: FspReportFormat | null;
}

export interface FspReportResponse {
  blob: Blob;
  filename: string;
  contentType: string;
}

const JSON_HEADERS: Record<string, string> = {
  Accept: 'application/octet-stream',
  'Content-Type': 'application/json',
};

const sanitizePayload = (payload: FspReportRequestPayload): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      cleaned[key] = trimmed;
      return;
    }
    cleaned[key] = value;
  });
  return cleaned;
};

const fallbackFilename = (reportId: FspReportId, format: FspReportFormat): string =>
  `report-${reportId}.${format}`;

const extractFilename = (
  response: Response,
  reportId: FspReportId,
  format: FspReportFormat,
): string => {
  const disposition = response.headers.get('content-disposition');
  if (!disposition) return fallbackFilename(reportId, format);

  // RFC 5987 `filename*=UTF-8''…` form first, then the simple
  // `filename="…"` form. Both are emitted by Spring's
  // ContentDisposition.builder().filename(name, UTF_8).
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through to the alternate parser
    }
  }
  const regularMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (regularMatch && regularMatch[1]) return regularMatch[1];
  return fallbackFilename(reportId, format);
};

const getAccessToken = async (): Promise<string | undefined> => {
  try {
    const { tokens } = (await fetchAuthSession()) ?? {};
    return tokens?.accessToken?.toString();
  } catch {
    return undefined;
  }
};

/**
 * POST /api/v1/fsp/reports/{reportId} — server renders the PDF and
 * returns it as a binary stream. Throws on non-2xx; the caller
 * surfaces the failure via the existing toast plumbing.
 */
export const requestReport = async (
  reportId: FspReportId,
  payload: FspReportRequestPayload,
): Promise<FspReportResponse> => {
  await ensureSessionFresh();
  const token = await getAccessToken();

  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;

  const format = (payload.format ?? 'pdf') as FspReportFormat;
  const url = `${API_BASE_URL}/v1/fsp/reports/${encodeURIComponent(reportId)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(sanitizePayload(payload)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      detail
        ? `Report request failed (${response.status}): ${detail}`
        : `Report request failed (${response.status})`,
    );
  }

  return {
    blob: await response.blob(),
    filename: extractFilename(response, reportId, format),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
};
