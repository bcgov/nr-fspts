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

/**
 * GET /api/v1/fsp/code-lists/fsp-amendment-numbers?fspId=… — lists every
 * amendment number defined on this FSP (proc maps 0 → "Original"). Used by
 * the FSP information page's amendment-picker dropdown.
 */
export function getFspAmendmentNumbers(fspId: string): Promise<CodeOption[]> {
  return getJson<CodeOption[]>(
    `/v1/fsp/code-lists/fsp-amendment-numbers?fspId=${encodeURIComponent(fspId)}`,
    'FSP amendment numbers lookup',
  );
}

/**
 * SILV_TREE_SPECIES_CODE list — backs the Standards View → Layers
 * Preferred/Acceptable species dropdowns. Bounded list (a few dozen
 * species), so callers cache it in component state for the session.
 */
export function getSilvTreeSpeciesCodes(): Promise<CodeOption[]> {
  return getJson<CodeOption[]>(
    `/v1/fsp/code-lists/species`,
    'Tree species codes lookup',
  );
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

/**
 * PUT /api/v1/fsp/{fspId} — updates FSP-300 header fields via the
 * backend's FspService.update() → MAINLINE(SAVE) path. Returns the
 * proc-echoed values so callers can refresh their local state without
 * a follow-up GET (any field the proc derived/canonicalised — status
 * code, revision count, etc. — comes back populated).
 *
 * Only the fields present on the request body are persisted by the
 * proc — null/empty stays null/empty so leaving a field out is safe.
 */
export async function updateFsp(
  fspId: string,
  payload: Partial<FspInformation>,
): Promise<FspInformation> {
  const res = await apiFetch(`/v1/fsp/${encodeURIComponent(fspId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail ? `FSP save failed (${res.status}): ${detail}` : `FSP save failed (${res.status})`,
    );
  }
  return res.json() as Promise<FspInformation>;
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

// ── FSP workflow state (Workflow tab) ──────────────────────────────
//
// Mirrors backend WorkflowState — the FSP_700_WORKFLOW.MAINLINE GET
// projection. Every field is nullable; the proc returns blank/null for
// the half of the form a particular FSP/amendment doesn't have data for.

export interface FspReviewItem {
  code: string;
  label: string;
  completedInd: string | null;
  entryUserId: string | null;
  entryTimestamp: string | null;
  comment: string | null;
}

export interface FspOtbh {
  offeredDate: string | null;
  offeredComment: string | null;
  heardDate: string | null;
  heardComment: string | null;
}

export interface FspDdmDecision {
  statusCode: string | null;
  name: string | null;
  submissionDate: string | null;
  decisionDate: string | null;
  effectiveDate: string | null;
  comment: string | null;
}

export interface FspExtensionDecision {
  statusCode: string | null;
  extensionId: string | null;
  name: string | null;
  submissionDate: string | null;
  decisionDate: string | null;
  effectiveDate: string | null;
  comment: string | null;
}

/** Effective FSPTS roles for the current user, projected by the backend. */
export interface FspWorkflowRoles {
  isReviewer: boolean;
  isDecisionMaker: boolean;
  isAdministrator: boolean;
}

export interface FspWorkflowState {
  fspId: string | null;
  fspAmendmentNumber: string | null;
  fspStatusCode: string | null;
  fspStatusDesc: string | null;
  /** Echoed back on SAVE_DDM_APP so the proc can route fsp_approval correctly. */
  fspAmendmentCode: string | null;
  reviewItems: FspReviewItem[];
  otbh: FspOtbh;
  ddmDecision: FspDdmDecision;
  extensionDecision: FspExtensionDecision;
  extensionIds: string | null;
  roles: FspWorkflowRoles;
}

/**
 * GET /api/v1/fsp/{fspId}/workflow-state — read-only projection of
 * FSP_700_WORKFLOW.MAINLINE (P_ACTION='GET'). Powers the Workflow tab.
 */
export function getFspWorkflowState(fspId: string): Promise<FspWorkflowState> {
  return getJson<FspWorkflowState>(
    `/v1/fsp/${encodeURIComponent(fspId)}/workflow-state`,
    'Workflow state load',
  );
}

/** Subset of FSP_700_WORKFLOW.MAINLINE inputs the per-section dialogs send. */
export interface FspWorkflowActionRequest {
  /** P_ACTION — e.g. "SAVE_REVIEW", "SAVE_OTBH_OFFERED", "SAVE_DDM_APP". */
  action: string;
  fspAmendmentNumber?: string;
  /** Required for SAVE_REVIEW — FNR/RS/ORS/DDM/OTHER. */
  milestoneType?: string;
  /** "Y" / "N" — required for SAVE_REVIEW + SAVE_OTBH_* + SAVE_DDM_* (N = reverse). */
  completed?: string;
  /** YYYY-MM-DD. Required for SAVE_OTBH_OFFERED; optional for SAVE_OTBH_HEARD. */
  otbhDate?: string;
  /** Current FSP status — required by SAVE_DDM_* branches. Echo from state. */
  fspStatusCode?: string;
  /** Current amendment code — required by SAVE_DDM_APP. Echo from state. */
  fspAmendmentCode?: string;
  /** YYYY-MM-DD. SAVE_DDM_APP / SAVE_DDM_REJ require submission + decision dates. */
  submissionDate?: string;
  /** YYYY-MM-DD. */
  decisionDate?: string;
  /** YYYY-MM-DD. Required for SAVE_DDM_APP / SAVE_EXT_APP (the "Approve" branches). */
  effectiveDate?: string;
  /** P_EXTENSION_ID — required by SAVE_EXT_APP / SAVE_EXT_REJ. */
  extensionId?: string;
  comments?: string;
}

/**
 * POST /api/v1/fsp/{fspId}/workflow/action — dispatches one
 * FSP_700_WORKFLOW.MAINLINE mutation. Backend returns the refreshed
 * {@link FspWorkflowState} so the Workflow tab can redraw without a
 * separate GET round-trip.
 */
export async function submitFspWorkflowAction(
  fspId: string,
  payload: FspWorkflowActionRequest,
): Promise<FspWorkflowState> {
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/workflow/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Workflow action failed (${res.status}): ${detail}`
        : `Workflow action failed (${res.status})`,
    );
  }
  return res.json() as Promise<FspWorkflowState>;
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

// Identified Areas / Map — combined list across all three legislation
// types (FRPA s.196(1), FRPA s.196(2), FPPR s.14(4)). Backend issues
// the three FSP_650_IDENTIFIED_AREAS_MAP.GET calls and tags each row
// with its source.
export interface FspIdentifiedArea {
  identifiedAreaId: string | null;
  identifiedAreaName: string | null;
  legislationType: string | null;
  legislationLabel: string | null;
}

export interface FspIdentifiedAreaList {
  areas: FspIdentifiedArea[];
}

export function getFspIdentifiedAreas(fspId: string): Promise<FspIdentifiedAreaList> {
  return getJson<FspIdentifiedAreaList>(
    `/v1/fsp/${encodeURIComponent(fspId)}/identified-areas`,
    'Identified areas load',
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
  /** STANDARDS_REGIME_SITE_SERIES_ID — needed to PUT/DELETE a row. */
  stdsRegimeSiteSeriesId: string | null;
  bgcZoneCode: string | null;
  bgcSubzoneCode: string | null;
  bgcVariant: string | null;
  bgcPhase: string | null;
  becSiteSeriesCd: string | null;
  becSiteSeriesPhaseCd: string | null;
  becSeral: string | null;
  /** Row-level optimistic-lock token. */
  revisionCount: string | null;
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
  // Round-tripped through Overview SAVE; not editable in the UI yet.
  noRegenEarlyOffsetYrs: string | null;
  noRegenLateOffsetYrs: string | null;
  additionalStandards: string | null;
  submittedByUserid: string | null;
  mofDefaultStandardInd: string | null;
  standardsAmendNumber: string | null;
  // Optimistic-lock token surfaced by FSP_550_STDS_PROPOSAL.GET.
  revisionCount: string | null;
  layers: StandardRegimeLayer[];
  districts: StandardRegimeDistrict[];
  agreementHolders: StandardRegimeAgreementHolder[];
  attachments: StandardRegimeAttachment[];
  bgcZones: StandardRegimeBgcZone[];
}

/**
 * Editable subset of {@link StandardRegimeDetail} for the Standards
 * View → Overview tab SAVE endpoint. Each field is optional — leaving
 * one out (or sending null) means "no change"; empty string clears.
 */
export interface StandardRegimeOverviewUpdate {
  standardsRegimeName?: string | null;
  standardsObjective?: string | null;
  geographicDescription?: string | null;
  additionalStandards?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  regenObligationInd?: string | null;
  regenDelayOffsetYrs?: string | null;
  freeGrowingEarlyOffsetYrs?: string | null;
  freeGrowingLateOffsetYrs?: string | null;
}

export async function updateStandardRegimeOverview(
  fspId: string,
  regimeId: string,
  amendmentNumber: string | undefined,
  payload: StandardRegimeOverviewUpdate,
): Promise<StandardRegimeDetail> {
  const qs = amendmentNumber
    ? `?amendmentNumber=${encodeURIComponent(amendmentNumber)}`
    : '';
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/overview${qs}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Standards overview save failed (${res.status}): ${detail}`
        : `Standards overview save failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeDetail>;
}

export function getStandardRegimeDetail(
  fspId: string,
  regimeId: string,
  amendmentNumber?: string,
): Promise<StandardRegimeDetail> {
  // Blank fspId → use the regime-only endpoint (org-unit + client
  // cursors come back regime-scoped instead of FSP-scoped). Lets
  // surfaces like the standards-search modal open a regime without
  // having to pick a specific FSP context first.
  if (!fspId || !fspId.trim()) {
    return getJson<StandardRegimeDetail>(
      `/v1/fsp/standards/${encodeURIComponent(regimeId)}/detail`,
      'Standards regime detail load',
    );
  }
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
  // Per-row revision_count from FSP_550_SUB_SPECIES — needed when
  // deleting (the proc's optimistic-lock check fails on a mismatch).
  revisionCount: string | null;
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
  // Layer-row revision_count — used for the SAVE optimistic-lock check.
  revisionCount: string | null;
  preferredSpecies: StandardRegimeSpecies[];
  acceptableSpecies: StandardRegimeSpecies[];
}

export function getStandardRegimeLayerDetail(
  fspId: string,
  regimeId: string,
  layerCode: string,
  layerId: string,
): Promise<StandardRegimeLayerDetail> {
  // Blank fspId → use the regime-only endpoint. Same payload shape;
  // just skips the FSP path segment so an empty fspId can't produce
  // a // double-slash 404.
  const basePath = fspId && fspId.trim()
    ? `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/layers/${encodeURIComponent(layerCode)}`
    : `/v1/fsp/standards/${encodeURIComponent(regimeId)}/layers/${encodeURIComponent(layerCode)}`;
  return getJson<StandardRegimeLayerDetail>(
    `${basePath}?layerId=${encodeURIComponent(layerId)}`,
    'Standards layer detail load',
  );
}

/**
 * Editable subset of {@link StandardRegimeLayerDetail} for the Layers
 * SAVE endpoint. Each field optional — null means "no change", empty
 * string clears. Species rows are managed separately by their own proc
 * and aren't included here.
 */
export interface StandardRegimeLayerUpdate {
  treeSizeUnitCode?: string | null;
  targetStocking?: string | null;
  minHorizontalDistance?: string | null;
  minPrefStockingStandard?: string | null;
  minStockingStandard?: string | null;
  residualBasalArea?: string | null;
  minPostSpacing?: string | null;
  maxPostSpacing?: string | null;
  maxConifer?: string | null;
  heightRelativeToComp?: string | null;
}

export async function updateStandardRegimeLayer(
  fspId: string,
  regimeId: string,
  layerCode: string,
  layerId: string | null,
  payload: StandardRegimeLayerUpdate,
): Promise<StandardRegimeLayerDetail> {
  // Omit the layerId query param entirely when creating a brand-new
  // layer — the backend's required=false annotation pairs with the
  // proc's auto-ADD branch (P_REVISION_COUNT null → ADD).
  const qs = layerId ? `?layerId=${encodeURIComponent(layerId)}` : '';
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/layers/${encodeURIComponent(layerCode)}${qs}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Layer save failed (${res.status}): ${detail}`
        : `Layer save failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeLayerDetail>;
}

/** Add a species row to a layer (preferred or acceptable). */
export async function addLayerSpecies(
  fspId: string,
  regimeId: string,
  layerCode: string,
  layerId: string,
  payload: { speciesCode: string; minHeight: string | null; preferred: boolean },
): Promise<StandardRegimeLayerDetail> {
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/layers/${encodeURIComponent(layerCode)}/species?layerId=${encodeURIComponent(layerId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Add species failed (${res.status}): ${detail}`
        : `Add species failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeLayerDetail>;
}

/** Delete a species row from a layer. Requires the row's revisionCount. */
export async function deleteLayerSpecies(
  fspId: string,
  regimeId: string,
  layerCode: string,
  layerId: string,
  speciesCode: string,
  preferred: boolean,
  revisionCount: string,
): Promise<StandardRegimeLayerDetail> {
  const qs = new URLSearchParams({
    layerId,
    preferred: preferred ? 'Y' : 'N',
    revisionCount,
  });
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/layers/${encodeURIComponent(layerCode)}/species/${encodeURIComponent(speciesCode)}?${qs.toString()}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Delete species failed (${res.status}): ${detail}`
        : `Delete species failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeLayerDetail>;
}

/**
 * Toggle a regime between single-layer ('I') and multi-layer (1-4).
 * The proc auto-detects the current shape, so we just POST without
 * a direction param. Returns the refreshed detail (the `layers` list
 * shrinks/grows so the layer tab strip rebuilds).
 */
export async function convertStandardRegimeLayers(
  fspId: string,
  regimeId: string,
  amendmentNumber: string | undefined,
): Promise<StandardRegimeDetail> {
  const qs = amendmentNumber
    ? `?amendmentNumber=${encodeURIComponent(amendmentNumber)}`
    : '';
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/convert-layers${qs}`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Layer conversion failed (${res.status}): ${detail}`
        : `Layer conversion failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeDetail>;
}

/** Payload for FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM (insert or update). */
export interface StandardRegimeBgcZoneUpsert {
  bgcZoneCode?: string | null;
  bgcSubzoneCode?: string | null;
  bgcVariant?: string | null;
  bgcPhase?: string | null;
  becSiteSeriesCd?: string | null;
  becSiteSeriesPhaseCd?: string | null;
  becSeral?: string | null;
}

/**
 * Insert a new BGC site-series row on the regime.
 *
 * @param amendmentNumber forwarded to the re-read after save. The
 *   underlying {@code FSP_550_STDS_PROPOSAL.GET} proc does an unguarded
 *   SELECT INTO on FOREST_STEWARDSHIP_PLAN by (fsp_id, amendment_number),
 *   so omitting the amendment surfaces as a confusing 404/noRecord.
 */
export async function addStandardRegimeBgcZone(
  fspId: string,
  regimeId: string,
  amendmentNumber: string | undefined,
  payload: StandardRegimeBgcZoneUpsert,
): Promise<StandardRegimeDetail> {
  const qs = amendmentNumber
    ? `?amendmentNumber=${encodeURIComponent(amendmentNumber)}`
    : '';
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/bgc-zones${qs}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Add BGC zone failed (${res.status}): ${detail}`
        : `Add BGC zone failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeDetail>;
}

/** Delete a BGC site-series row. Requires the row's revisionCount for the optimistic-lock check. */
export async function deleteStandardRegimeBgcZone(
  fspId: string,
  regimeId: string,
  siteSeriesId: string,
  revisionCount: string,
  amendmentNumber: string | undefined,
): Promise<StandardRegimeDetail> {
  const qs = new URLSearchParams({ revisionCount });
  if (amendmentNumber) qs.set('amendmentNumber', amendmentNumber);
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/bgc-zones/${encodeURIComponent(siteSeriesId)}?${qs.toString()}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Delete BGC zone failed (${res.status}): ${detail}`
        : `Delete BGC zone failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeDetail>;
}

/** Update an existing BGC site-series row. Requires the row's revisionCount. */
export async function updateStandardRegimeBgcZone(
  fspId: string,
  regimeId: string,
  siteSeriesId: string,
  revisionCount: string,
  amendmentNumber: string | undefined,
  payload: StandardRegimeBgcZoneUpsert,
): Promise<StandardRegimeDetail> {
  const qs = new URLSearchParams({ revisionCount });
  if (amendmentNumber) qs.set('amendmentNumber', amendmentNumber);
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/bgc-zones/${encodeURIComponent(siteSeriesId)}?${qs.toString()}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Update BGC zone failed (${res.status}): ${detail}`
        : `Update BGC zone failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeDetail>;
}

/**
 * Upload a single attachment file to a standards regime. Returns the
 * refreshed regime detail so the Attachments tab redraws with the new
 * row. The amendment number is forwarded into the re-read for the same
 * reason BGC save does — the GET proc throws noRecord without it.
 */
export async function addStandardRegimeAttachment(
  fspId: string,
  regimeId: string,
  amendmentNumber: string | undefined,
  file: File,
): Promise<StandardRegimeDetail> {
  const form = new FormData();
  form.append('file', file);
  const qs = amendmentNumber
    ? `?amendmentNumber=${encodeURIComponent(amendmentNumber)}`
    : '';
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/attachments${qs}`,
    { method: 'POST', body: form },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Standards attachment upload failed (${res.status}): ${detail}`
        : `Standards attachment upload failed (${res.status})`,
    );
  }
  return res.json() as Promise<StandardRegimeDetail>;
}

/**
 * Triggers a browser download for a single standards-regime attachment.
 * Mirrors downloadFspAttachment — backend streams the BLOB with a
 * Content-Disposition header; we parse it for the filename and fall
 * back to the caller-supplied label.
 */
export async function downloadStandardRegimeAttachment(
  fspId: string,
  regimeId: string,
  attachmentId: string,
  fallbackName: string,
): Promise<void> {
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/standards/${encodeURIComponent(regimeId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
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
 * Per-FSP attachment categories — drives the "Add Attachment" dialog
 * dropdown. Backed by FSP_CODE_LISTS.get_attach_reference_list which
 * filters the allowed types by FSP/amendment state.
 */
export function getAttachmentCategories(fspId: string): Promise<CodeOption[]> {
  return getJson<CodeOption[]>(
    `/v1/fsp/${encodeURIComponent(fspId)}/attachment-categories`,
    'Attachment categories lookup',
  );
}

/** Upload a single attachment file under the given category typeCode. */
export async function uploadFspAttachment(
  fspId: string,
  typeCode: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  // typeCode goes in the query string (matches the backend @RequestParam),
  // not the multipart body — fspSubmissions.ts uses the same convention.
  const res = await apiFetch(
    `/v1/fsp/${encodeURIComponent(fspId)}/attachments?typeCode=${encodeURIComponent(typeCode)}`,
    { method: 'POST', body: form },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Attachment upload failed (${res.status}): ${detail}`
        : `Attachment upload failed (${res.status})`,
    );
  }
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
