# FSPTS Documentation

Start with the [root README](../README.md) for the project overview and quick
start. These docs go deeper:

| Doc | Read it when you need to… |
|-----|---------------------------|
| [architecture.md](architecture.md) | Understand the layers, the request flow, and the stored-procedure DAO pattern that defines this codebase |
| [roles-and-security.md](roles-and-security.md) | Know what each of the six FSPTS roles can do and how authorization is enforced front-to-back |
| [database.md](database.md) | Work with the legacy Oracle packages (`nr-mof-db`), the ownership fence, or the status state machine |
| [submissions.md](submissions.md) | Touch the XML / GeoJSON submission pipeline |
| [submission-geojson-spec.md](submission-geojson-spec.md) | Hand a client the GeoJSON upload format spec |

Module-level docs:

- [backend/README.md](../backend/README.md) — running and structuring the API
- [frontend/README.md](../frontend/README.md) — running and structuring the SPA
- [frontend/e2e/README.md](../frontend/e2e/README.md) — the Playwright suite

The FSP status state machine has its own source-referenced doc at
[`backend/src/main/resources/schemas/fsp/MOF/fsp-status-state-machine.md`](../backend/src/main/resources/schemas/fsp/MOF/fsp-status-state-machine.md).
