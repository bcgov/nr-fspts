import { apiFetch } from '@/auth/auth';
import type { PageableResponse } from './fspSearch';

// Mirrors backend ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchRequest.
// clientName is the legacy CLIENT_NAME column = surname / last name.
export interface ClientSearchRequest {
  clientNumber?: string;
  clientAcronym?: string;
  clientName?: string;
  legalFirstName?: string;
  legalMiddleName?: string;
  page?: number;
  size?: number;
}

// Mirrors backend ClientSearchResult — one row of the cursor returned
// by PKG_SIL21_CLIENT_SEARCH.get_client_search. clientName arrives
// already concatenated as "Surname, First Middle" (the proc does this
// via DECODE inside the SELECT); render it verbatim.
export interface ClientSearchResult {
  clientNumber: string | null;
  clientAcronym: string | null;
  displayClientNumber: string | null;
  clientName: string | null;
  legalFirstName: string | null;
  legalMiddleName: string | null;
  clientLocnCode: string | null;
  clientLocnName: string | null;
  city: string | null;
  clientStatusCode: string | null;
}

function buildQuery(criteria: ClientSearchRequest): string {
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
 * GET /api/v1/clients/search — wraps PKG_SIL21_CLIENT_SEARCH.
 * Returns a PageableResponse (in-memory paginated; the proc itself has
 * no native pagination).
 */
export async function searchClients(
  criteria: ClientSearchRequest,
): Promise<PageableResponse<ClientSearchResult>> {
  const qs = buildQuery(criteria);
  const path = qs ? `/v1/clients/search?${qs}` : '/v1/clients/search';
  const res = await apiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      detail
        ? `Client search failed (${res.status}): ${detail}`
        : `Client search failed (${res.status})`,
    );
  }
  return res.json() as Promise<PageableResponse<ClientSearchResult>>;
}
