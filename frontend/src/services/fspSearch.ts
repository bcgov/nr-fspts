import { apiFetch } from '@/auth/auth';

// Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.CodeOption.
export interface CodeOption {
  code: string;
  description: string;
}

async function getJson<T>(path: string, label: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `${label} failed (${res.status}): ${detail}`
        : `${label} failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * GET /api/v1/fsp/code-lists/org-units — populates the Organization Unit
 * dropdown. Backed by FSP_CODE_LISTS.get_org_unit_filtered (unfiltered).
 */
export function getOrgUnits(): Promise<CodeOption[]> {
  return getJson<CodeOption[]>('/v1/fsp/code-lists/org-units', 'Org units lookup');
}

/**
 * GET /api/v1/fsp/code-lists/fsp-status — populates the Status dropdown.
 * Backed by FSP_CODE_LISTS.get_fsp_status_code.
 */
export function getFspStatusCodes(): Promise<CodeOption[]> {
  return getJson<CodeOption[]>('/v1/fsp/code-lists/fsp-status', 'FSP status codes lookup');
}

// Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchRequest.
// All fields are optional; only non-empty ones are serialized into the
// query string by buildSearchQuery().
export interface FspSearchRequest {
  fspId?: string;
  fspPlanName?: string;
  orgUnitNo?: string;
  ahClientNumber?: string;
  fspAmendmentName?: string;
  fspDateStart?: string;
  fspDateEnd?: string;
  fspDateType?: string;
  fspStatusCode?: string;
  approvalRequired?: string;
  // Pagination + sort. Defaults applied server-side when omitted
  // (page=0, size=10, sortBy=fspId, sortDir=desc) so the front-end
  // doesn't have to repeat them on the first request.
  page?: number;
  size?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// Mirrors backend PageableResponse<T>. Wire-compatible with Spring
// Data's Page<T> so REPT's TableResource shape works unchanged if we
// ever port it.
export interface PageableResponse<T> {
  content: T[];
  page: {
    size: number;
    number: number;
    totalElements: number;
    totalPages: number;
  };
}

// Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.InboxRequest. Same
// page/size/sort defaults as FspSearchRequest. orgUnitNo is optional —
// when blank the backend falls back to the user's JWT
// custom:org_unit_no claim (matches legacy Fsp200InboxForm.setDefaults).
export interface InboxRequest {
  orgUnitNo?: string;
  fspId?: string;
  fspPlanName?: string;
  fspStatusCode?: string;
  ahClientNumber?: string;
  page?: number;
  size?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchResult — the
// union of FSP_100_SEARCH and fsp_200_inbox cursor columns. Several fields
// are populated only by one of those two sources (see the Javadoc on the
// backend DTO). All values arrive as VARCHAR strings except numberOfFdu.
export interface FspSearchResult {
  fspId: string | null;
  planName: string | null;
  fspAmendmentName: string | null;
  fspAmendmentNumber: string | null;
  orgUnitCode: string | null;
  planStartDate: string | null;
  planEndDate: string | null;
  planSubmissionDate: string | null;
  agreementHolder: string | null;
  amendmentApprovalRequirdInd: string | null;
  extensionNumber: string | null;
  updateUserid: string | null;
  fspStatusDesc: string | null;
  numberOfFdu: number | null;
}

// Build a `?fspId=…&fspPlanName=…` string, omitting any empty/whitespace
// string values. Numeric pagination params (page/size) pass through even
// when 0 — page=0 is a legitimate first-page request that the backend
// needs to see. Sending blank string criteria would otherwise be treated
// by the backend as "filter for empty string" rather than "no filter".
// Generic over the criteria object shape so the same builder serves
// FspSearchRequest, InboxRequest, and future request DTOs without
// per-call type assertions.
function buildSearchQuery(criteria: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(criteria)) {
    if (typeof value === 'string' && value.trim()) {
      params.append(key, value.trim());
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      params.append(key, String(value));
    }
  }
  return params.toString();
}

/**
 * GET /api/v1/fsp/search — wraps FSP_100_SEARCH.MAINLINE.
 *
 * apiFetch handles Bearer-token injection and 401 → session clear. Any
 * non-2xx response is surfaced as a thrown Error so callers can render
 * the message inline instead of silently returning an empty array.
 */
export async function searchFsp(
  criteria: FspSearchRequest,
): Promise<PageableResponse<FspSearchResult>> {
  const qs = buildSearchQuery(criteria as Record<string, unknown>);
  const path = qs ? `/v1/fsp/search?${qs}` : '/v1/fsp/search';
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail ? `Search failed (${res.status}): ${detail}` : `Search failed (${res.status})`,
    );
  }
  return res.json() as Promise<PageableResponse<FspSearchResult>>;
}

/**
 * GET /api/v1/fsp/inbox — wraps fsp_200_inbox.MAINLINE.
 *
 * Returns the same FspSearchResult shape as searchFsp (the inbox proc
 * populates a subset of fields; see InboxService Javadoc). When the
 * criteria omits orgUnitNo the backend defaults it from the JWT, so a
 * no-criteria call returns the current user's home-district inbox.
 */
export async function searchInbox(
  criteria: InboxRequest,
): Promise<PageableResponse<FspSearchResult>> {
  const qs = buildSearchQuery(criteria as Record<string, unknown>);
  const path = qs ? `/v1/fsp/inbox?${qs}` : '/v1/fsp/inbox';
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail ? `Inbox load failed (${res.status}): ${detail}` : `Inbox load failed (${res.status})`,
    );
  }
  return res.json() as Promise<PageableResponse<FspSearchResult>>;
}

export interface FspExtentResponse {
  // "minX,minY,maxX,maxY" — null when the FSP/amendment has no FDU
  // geometry. Callers treat null as "no Map View available" rather
  // than as an error.
  extent: string | null;
}

/**
 * Fetches the Map View MBR for a single FSP + amendment. Lazy-loaded
 * by inbox/results pages on the user's Map View click — the spatial
 * query is per-row, so doing it eagerly on page render would mean N
 * round-trips per page that the user mostly won't open.
 */
export async function getFspExtent(
  fspId: string,
  amendmentNumber: string,
): Promise<FspExtentResponse> {
  const path = `/v1/fsp/${encodeURIComponent(fspId)}/amendments/${encodeURIComponent(
    amendmentNumber,
  )}/extent`;
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Extent load failed (${res.status}): ${detail}`
        : `Extent load failed (${res.status})`,
    );
  }
  return res.json() as Promise<FspExtentResponse>;
}
