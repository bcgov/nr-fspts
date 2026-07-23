# FSPTS Documentation

Start with the [root README](../README.md) for the project overview and quick
start. These docs go deeper:

| Doc | Read it when you need to… |
|-----|---------------------------|
| [architecture.md](architecture.md) | Understand the layers, the request flow, and the stored-procedure DAO pattern that defines this codebase |
| [roles-and-security.md](roles-and-security.md) | Know what each of the six FSPTS roles can do and how authorization is enforced front-to-back |
| [permission-matrix.md](permission-matrix.md) | See the role permissions broken out **by FSP status** (activity × state × role) — a draft matrix for client confirmation |
| [database.md](database.md) | Work with the legacy Oracle packages (`nr-mof-db`), the ownership fence, or the status state machine |
| [fsp-dates.md](fsp-dates.md) | Figure out what an FSP date means — every plan/extension/OTBH/audit date, its DB column, and the legacy label it maps to |
| [submissions.md](submissions.md) | Touch the XML / GeoJSON submission pipeline |
| [submission-geojson-spec.md](submission-geojson-spec.md) | Hand a client the GeoJSON upload format spec |
| [virus-scanning.md](virus-scanning.md) | Work on the ClamAV upload scanning — config, fail-open policy, or the cross-namespace NetworkPolicy/secrets |
| [reports.md](reports.md) | Work on the JasperReports PDF/CSV reporting (the one part that bypasses the proc layer) |
| [notifications.md](notifications.md) | Touch email — the workflow event emails or the scheduled district-designate digest |
| [fam-integration.md](fam-integration.md) | Work with the FAM IDIR identity-lookup (user picker or the digest's email resolution) |

Module-level docs:

- [backend/README.md](../backend/README.md) — running and structuring the API
- [frontend/README.md](../frontend/README.md) — running and structuring the SPA
- [frontend/e2e/README.md](../frontend/e2e/README.md) — the Playwright suite

The FSP status state machine has its own source-referenced doc at
[`backend/src/main/resources/schemas/fsp/MOF/fsp-status-state-machine.md`](../backend/src/main/resources/schemas/fsp/MOF/fsp-status-state-machine.md).
