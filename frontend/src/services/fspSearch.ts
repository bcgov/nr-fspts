import {apiFetch} from '@/services/apiFetch';

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
// Mirrors backend FspRequest (struct/v1/FspRequest.java) — the read-only
// projection of FSP_300_INFORMATION.MAINLINE. Edit-mode fields exist on
// the backend record but are only populated/written when we extend this
// page beyond read-only.
export interface FspAgreementHolder {
  clientNumber: string | null;
  clientName: string | null;
  agreementDescription: string | null;
}

export interface FspDistrict {
  orgUnitNo: string | null;
  orgUnitCode: string | null;
  orgUnitName: string | null;
}

export interface FspInformation {
  fspId: string | null;
  fspPlanName: string | null;
  fspStatusCode: string | null;
  fspStatusDesc: string | null;
  fspAmendmentNumber: string | null;
  amendmentName: string | null;
  amendmentEfftvDate: string | null;
  amendmentAuthority: string | null;
  amendmentReason: string | null;
  fspAmendmentCode: string | null;
  fspAmendmentDesc: string | null;
  fspPlanStartDate: string | null;
  fspPlanEndDate: string | null;
  fspPlanSubmissionDate: string | null;
  fspPlanTermYears: string | null;
  fspPlanTermMonths: string | null;
  fspExpiryDate: string | null;
  fspContactName: string | null;
  fspTelephoneNumber: string | null;
  fspEmailAddress: string | null;
  transitionInd: string | null;
  frpa197electionInd: string | null;
  fspExtensionStat: string | null;
  revisionCount: string | null;
  agreementHolders: FspAgreementHolder[] | null;
  districts: FspDistrict[] | null;
}

/**
 * GET /api/v1/fsp/{fspId}[?amendmentNumber=N] — fetches the FSP via
 * fsp_300_information.MAINLINE (action GET). Amendment number is
 * optional; omitting it returns the latest amendment.
 */
export async function getFspById(
  fspId: string,
  amendmentNumber?: string,
): Promise<FspInformation> {
  const qs = amendmentNumber
    ? `?amendmentNumber=${encodeURIComponent(amendmentNumber)}`
    : '';
  return getJson<FspInformation>(`/v1/fsp/${encodeURIComponent(fspId)}${qs}`, 'FSP load');
}

// ── FSP sub-resources (tabs on the FSP information page) ───────────

// Mirrors backend WorkflowResponse — single row from /workflow.
export interface FspWorkflowEvent {
  amendmentNumber: string | null;
  extensionNumber: string | null;
  eventDateTime: string | null;
  userId: string | null;
  event: string | null;
  description: string | null;
  approvalRequestIndicator: string | null;
  submissionId: string | null;
}

export function getFspWorkflow(fspId: string): Promise<FspWorkflowEvent[]> {
  return getJson<FspWorkflowEvent[]>(
    `/v1/fsp/${encodeURIComponent(fspId)}/workflow`,
    'Workflow load',
  );
}

/**
 * GET /api/v1/fsp/{fspId}/history — full audit trail from FSP_800_HISTORY.
 * Same row shape as /workflow; the history endpoint returns the unfiltered
 * timeline of events across every amendment + extension on this FSP.
 */
export function getFspHistory(fspId: string): Promise<FspWorkflowEvent[]> {
  return getJson<FspWorkflowEvent[]>(
    `/v1/fsp/${encodeURIComponent(fspId)}/history`,
    'History load',
  );
}

// Extension-summary payload mirrors backend ExtensionSummary (record + nested
// Extension record). The page tomb-stones the FSP-level fields at the top
// and renders one row per extension.
export interface FspExtension {
  extensionId: string | null;
  extensionNumber: string | null;
  statusCode: string | null;
  statusDescription: string | null;
  planTermYears: string | null;
  planTermMonths: string | null;
  planStartDate: string | null;
  planEndDate: string | null;
  submissionDate: string | null;
  decisionDate: string | null;
  approvalDate: string | null;
  rejectDate: string | null;
  fspAmendmentNumber: string | null;
  statusComment: string | null;
}

export interface FspExtensionSummary {
  fspId: string | null;
  fspPlanName: string | null;
  originalEffectiveDate: string | null;
  originalExpiryDate: string | null;
  currentPlanTermYears: string | null;
  currentPlanTermMonths: string | null;
  currentExpiryDate: string | null;
  extensions: FspExtension[];
}

export function getFspExtensions(fspId: string): Promise<FspExtensionSummary> {
  return getJson<FspExtensionSummary>(
    `/v1/fsp/${encodeURIComponent(fspId)}/extensions`,
    'Extension summary load',
  );
}

// Mirrors backend FduList — one row per FDU on the FDU/Map tab.
export interface FspFdu {
  fduId: string | null;
  fduName: string | null;
  licences: string | null;
}

export interface FspFduList {
  fduAmendmentNumber: string | null;
  fdus: FspFdu[];
}

export function getFspFduList(fspId: string): Promise<FspFduList> {
  return getJson<FspFduList>(
    `/v1/fsp/${encodeURIComponent(fspId)}/fdu-list`,
    'FDU list load',
  );
}

// Mirrors backend StandardRequest — single row from /standards.
export interface FspStandardRow {
  standardsRegimeId: string | null;
  standardsRegimeName: string | null;
  standardsObjective: string | null;
  standardsAmndNumber: string | null;
  standardsBgc: string | null;
  standardsRegimeStatus: string | null;
  standardsEffectiveDate: string | null;
  defaultStandardInd: string | null;
}

export function getFspStandards(fspId: string): Promise<FspStandardRow[]> {
  return getJson<FspStandardRow[]>(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards`,
    'Stocking standards load',
  );
}

// Mirrors backend StandardRegimeDetail (FSP_550_STDS_PROPOSAL.GET) —
// the FSP250 detail panel that opens below the standards table on
// row select.
export interface StandardRegimeDistrict {
  orgUnitNo: string | null;
  orgUnitCode: string | null;
  orgUnitName: string | null;
}

export interface StandardRegimeAgreementHolder {
  clientNumber: string | null;
  clientName: string | null;
  clientAcronym: string | null;
}

export interface StandardRegimeAttachment {
  attachmentId: string | null;
  attachmentName: string | null;
  attachmentDescription: string | null;
  mimeTypeCode: string | null;
  fileSize: string | null;
}

// Drives the Layers sub-tab strip. `layerCode` is the proc's value
// (I = single, 1 = mature, 2 = pole, 3 = sapling, 4 = regen).
export interface StandardRegimeLayer {
  layerCode: string | null;
  layerId: string | null;
}

export interface StandardRegimeBgcZone {
  bgcZoneCode: string | null;
  bgcSubzoneCode: string | null;
  bgcVariant: string | null;
  bgcPhase: string | null;
  becSiteSeriesCd: string | null;
  becSiteSeriesPhaseCd: string | null;
  becSeral: string | null;
}

export interface StandardRegimeDetail {
  standardsRegimeId: string | null;
  fspIdList: string | null;
  standardsRegimeName: string | null;
  standardsObjective: string | null;
  regulationCode: string | null;
  regulationDescription: string | null;
  geographicDescription: string | null;
  standardsRegimeStatusCode: string | null;
  statusDescription: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  regenObligationInd: string | null;
  regenDelayOffsetYrs: string | null;
  freeGrowingEarlyOffsetYrs: string | null;
  freeGrowingLateOffsetYrs: string | null;
  additionalStandards: string | null;
  submittedByUserid: string | null;
  mofDefaultStandardInd: string | null;
  standardsAmendNumber: string | null;
  layers: StandardRegimeLayer[];
  districts: StandardRegimeDistrict[];
  agreementHolders: StandardRegimeAgreementHolder[];
  attachments: StandardRegimeAttachment[];
  bgcZones: StandardRegimeBgcZone[];
}

export function getStandardRegimeDetail(
  fspId: string,
  regimeId: string,
  amendmentNumber?: string,
): Promise<StandardRegimeDetail> {
  const qs = amendmentNumber
    ? `?amendmentNumber=${encodeURIComponent(amendmentNumber)}`
    : '';
  return getJson<StandardRegimeDetail>(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/detail${qs}`,
    'Standards regime detail load',
  );
}

// Per-layer detail (FSP_550_SUB_LAYERS + FSP_550_SUB_SPECIES) — drives
// the body of each Layers sub-tab.
export interface StandardRegimeSpecies {
  code: string | null;
  description: string | null;
  minHeight: string | null;
}

export interface StandardRegimeLayerDetail {
  layerCode: string | null;
  layerId: string | null;
  treeSizeUnitCode: string | null;
  targetStocking: string | null;
  minHorizontalDistance: string | null;
  minPrefStockingStandard: string | null;
  minStockingStandard: string | null;
  residualBasalArea: string | null;
  minPostSpacing: string | null;
  maxPostSpacing: string | null;
  maxConifer: string | null;
  heightRelativeToComp: string | null;
  preferredSpecies: StandardRegimeSpecies[];
  acceptableSpecies: StandardRegimeSpecies[];
}

export function getStandardRegimeLayerDetail(
  fspId: string,
  regimeId: string,
  layerCode: string,
  layerId: string,
): Promise<StandardRegimeLayerDetail> {
  return getJson<StandardRegimeLayerDetail>(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/layers/${encodeURIComponent(layerCode)}?layerId=${encodeURIComponent(layerId)}`,
    'Standards layer detail load',
  );
}

// Mirrors backend AttachmentResponse — single row from /attachments.
// The `category` field comes from the per-cursor section labels the
// proc keeps separate (FSP Legal Documents, DDM Decision, etc.) —
// flattened here but tagged so the table can group/label rows.
export interface FspAttachmentRow {
  fspAttachmentId: string | null;
  fspAmendmentNumber: string | null;
  attachmentName: string | null;
  attachmentDescription: string | null;
  attachmentSize: string | null;
  consolidatedInd: string | null;
  category: string | null;
}

export function getFspAttachments(fspId: string): Promise<FspAttachmentRow[]> {
  return getJson<FspAttachmentRow[]>(
    `/v1/fsp/${encodeURIComponent(fspId)}/attachments`,
    'Attachments load',
  );
}

/**
 * Triggers a browser download for a single FSP attachment. The
 * backend streams the BLOB with Content-Disposition; we resolve the
 * filename from that header (fallback: the {@code attachmentName}
 * passed in by the caller).
 */
export async function downloadFspAttachment(
  fspId: string,
  attachmentId: string,
  fallbackName: string,
): Promise<void> {
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Attachment download failed (${res.status}): ${detail}`
        : `Attachment download failed (${res.status})`,
    );
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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

// ── District Auto-Notification (Admin) ────────────────────────────

export interface NotificationDesignate {
  designateId: string | null;
  designateIdir: string;
  orgUnitNo?: string | null;
  displayName?: string | null;
  emailAddress?: string | null;
}

// ── FAM IDIR directory lookup ─────────────────────────────────────

export interface UserSummary {
  userId: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  idirGuid?: string | null;
  idirUserGuid?: string | null;
}

export interface UserSearchResponse {
  results: UserSummary[];
  total: number;
  page: number;
  size: number;
}

export interface UserSearchParams {
  userId?: string;
  firstName?: string;
  lastName?: string;
  size?: number;
}

/** GET /api/v1/fsp/users/search — passes through to the FAM identity-lookup API. */
export async function searchUsers(params: UserSearchParams): Promise<UserSearchResponse> {
  const qs = new URLSearchParams();
  if (params.userId) qs.set('userId', params.userId);
  if (params.firstName) qs.set('firstName', params.firstName);
  if (params.lastName) qs.set('lastName', params.lastName);
  if (params.size && params.size > 0) qs.set('size', String(params.size));
  const path = `/v1/fsp/users/search${qs.toString() ? `?${qs}` : ''}`;
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail ? `User search failed (${res.status}): ${detail}` : `User search failed (${res.status})`,
    );
  }
  return res.json() as Promise<UserSearchResponse>;
}

/** GET /api/v1/fsp/admin/district-notifications?orgUnitNo=… */
export async function getDistrictDesignates(orgUnitNo: string): Promise<NotificationDesignate[]> {
  const path = `/v1/fsp/admin/district-notifications?orgUnitNo=${encodeURIComponent(orgUnitNo)}`;
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail ? `Designate load failed (${res.status}): ${detail}` : `Designate load failed (${res.status})`,
    );
  }
  return res.json() as Promise<NotificationDesignate[]>;
}

/** POST /api/v1/fsp/admin/district-notifications */
export async function addDistrictDesignate(
  orgUnitNo: string,
  designateIdir: string,
): Promise<void> {
  const res = await apiFetch('/v1/fsp/admin/district-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgUnitNo, designateIdir }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail ? `Add designate failed (${res.status}): ${detail}` : `Add designate failed (${res.status})`,
    );
  }
}

/** DELETE /api/v1/fsp/admin/district-notifications/{designateId} */
export async function removeDistrictDesignate(designateId: string): Promise<void> {
  const res = await apiFetch(
    `/v1/fsp/admin/district-notifications/${encodeURIComponent(designateId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Remove designate failed (${res.status}): ${detail}`
        : `Remove designate failed (${res.status})`,
    );
  }
}
