import { apiFetch } from '@/services/apiFetch';
import type { PageableResponse } from '@/services/fspSearch';

/**
 * Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.StandardsSearchRequest.
 * All fields are optional; only non-empty ones are serialized into the
 * query string. The proc requires at least one criterion server-side.
 */
export interface StandardsSearchRequest {
  defaultStandard?: string;
  standardsRegimeStatusCode?: string;
  orgUnitNo?: string;
  fspId?: string;
  clientNumber?: string;
  clientName?: string;
  standardsRegimeId?: string;
  standardsRegimeName?: string;
  standardsObjective?: string;
  preferredSpecies?: string;
  acceptableSpecies?: string;
  expiryDateFrom?: string;
  expiryDateTo?: string;
  bgcZoneCode?: string;
  bgcSubzoneCode?: string;
  bgcVariant?: string;
  bgcPhase?: string;
  becSiteSeriesCd?: string;
  becSiteSeriesPhaseCd?: string;
  becSeral?: string;
  page?: number;
  size?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/** Mirrors backend StandardsSearchResult — one row of FSP_501_STDS_SRCH. */
export interface StandardsSearchResult {
  standardsRegimeId: string | null;
  standardsRegimeName: string | null;
  standardsObjective: string | null;
  bgc: string | null;
  clientNumber: string | null;
  status: string | null;
  expiryDate: string | null;
  fspIdList: string | null;
}

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

/** GET /api/v1/fsp/standards/search — wraps FSP_501_STDS_SRCH.MAINLINE. */
export async function searchStandards(
  criteria: StandardsSearchRequest,
): Promise<PageableResponse<StandardsSearchResult>> {
  const qs = buildSearchQuery(criteria as Record<string, unknown>);
  const path = qs ? `/v1/fsp/standards/search?${qs}` : '/v1/fsp/standards/search';
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Standards search failed (${res.status}): ${detail}`
        : `Standards search failed (${res.status})`,
    );
  }
  return res.json() as Promise<PageableResponse<StandardsSearchResult>>;
}
