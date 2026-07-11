import { apiFetch, readErrorMessage } from '@/services/apiFetch';
import type { PageableResponse } from './fspSearch';

// Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.BgcSearchRequest.
// All seven BEC criteria are blank-tolerant — the proc's LIKE predicates
// fold a blank to "match everything for this column".
export interface BgcSearchRequest {
  bgcZoneCode?: string;
  bgcSubzoneCode?: string;
  bgcVariant?: string;
  bgcPhase?: string;
  becSiteSeriesCd?: string;
  becSiteSeriesPhaseCd?: string;
  becSeral?: string;
  page?: number;
  size?: number;
}

// Mirrors backend BgcSearchResult — one row of the cursor returned by
// SIL_52_BGC_SEARCH_V003.MAINLINE(GET), sourced from BIOGEOCLIMATIC_CATALOGUE
// outer-joined to SITE_SERIES_CATALOGUE.
export interface BgcSearchResult {
  bgcZoneCode: string | null;
  bgcSubzoneCode: string | null;
  bgcVariant: string | null;
  bgcPhase: string | null;
  becSiteSeriesCd: string | null;
  becSiteSeriesPhaseCd: string | null;
  becSeral: string | null;
  /** NVL(site_series.description, biogeoclimatic.notes) — friendly label. */
  siteSeriesDesc: string | null;
}

function buildQuery(criteria: BgcSearchRequest): string {
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
 * GET /api/v1/bgc-zones/search — wraps PKG_SIL52_BGC_SEARCH.
 * Returns a PageableResponse (the proc has no native pagination; the
 * service slices the full cursor in memory).
 */
export async function searchBgcZones(
  criteria: BgcSearchRequest,
): Promise<PageableResponse<BgcSearchResult>> {
  const qs = buildQuery(criteria);
  const path = qs ? `/v1/bgc-zones/search?${qs}` : '/v1/bgc-zones/search';
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await readErrorMessage(res);
    throw new Error(detail || `BGC zone search failed (${res.status})`);
  }
  return res.json() as Promise<PageableResponse<BgcSearchResult>>;
}
