# Reports (JasperReports)

FSPTS generates PDF/CSV reports with **JasperReports 6.21.5** (plus JFreeChart
for charts and OpenPDF as the PDF backend). This is the one part of the backend
that **does not** go through the stored-procedure DAO layer.

## The architectural exception

Everywhere else, the API calls PL/SQL packages and maps cursors (see
[database.md](database.md)). Reports are different: the **SQL lives inside the
`.jrxml` templates**, and Jasper fills them **directly against a raw Oracle
`Connection`** taken from the `DataSource`:

```java
JasperPrint print = JasperFillManager.fillReport(jasperReport, params, connection);
```

So a report's data is whatever queries its template runs — not a proc result.
Keep that in mind: report output won't necessarily match an API endpoint, and
report SQL is maintained in the JRXML, not in Java or `nr-mof-db`.

## How it works

| Piece | Responsibility |
|-------|----------------|
| `service/v1/report/FspReportService` | The engine: compile, fill, export |
| `service/v1/report/FspReportDefinition` | The report catalog (an enum) |
| `service/v1/report/FspReportParameterProvider` | Builds the Jasper parameter map per report |
| `controller/v1/FspReportController` | `POST /api/v1/fsp/reports/{reportId}` → binary body |
| `src/main/resources/reports/*.jrxml` | Templates (main reports + subreports + header) |

**Compile + cache.** Templates compile to a `JasperReport` and are cached in a
`ConcurrentHashMap`. `@PostConstruct warmCompileCache()` pre-compiles every
template at startup so a broken JRXML shows up in deploy logs — but a compile
failure does **not** abort boot (it's logged and degrades to a request-time
error). On-demand fills read the same cache.

**Templates are keyed by enum name.** A `FspReportDefinition` value's
`name()` is the JRXML base filename at `classpath:reports/<NAME>.jrxml`:

| Enum / file (`<NAME>.jrxml`) | API id | Notes |
|---|---|---|
| `REPORT_FSP_SUMMARY` | `fsp-summary` | requires an org unit; optional client #, FSP id, date range |
| `REPORT_FSP_STOCKING_STANDARDS` | `fsp-stocking-standards` | requires an FSP id |

**Parameters.** `FspReportParameterProvider` maps the request DTO to the
`p_*` parameters the JRXML declares (`p_org_unit_no`, `p_fsp_id`,
`p_client_number`, `p_fsp_start_date`, `p_fsp_end_date`, `p_userid`,
`p_report_id`, …). Jasper silently ignores params a template doesn't declare,
so a name typo just yields a blank filter. It also injects `SUBREPORT_DIR` so a
main template can locate its subreports at fill time.

**Subreports.** The main reports pull in the many `SubReport*.jrxml` files plus
`FSPRPT_HEADER_landscape.jrxml` and `BC_Govt_Logo.png`. They're resolved
through the `SUBREPORT_DIR` parameter, computed from the `classpath:reports/`
URL.

**Export.** `FspReportFormat` is `PDF` or `CSV`:
- `PDF` → `JasperExportManager.exportReportToPdf` (full layout).
- `CSV` → `JRCsvExporter` — a flat dump of the **main dataset only** (bands,
  images, and subreports are dropped, as expected for CSV).

## Endpoint & auth

`POST /api/v1/fsp/reports/{reportId}` returns the binary body with the right
`Content-Type` + `Content-Disposition` filename. Errors map to:

| Exception | HTTP |
|-----------|------|
| `ReportNotFoundException` (no JRXML / unknown id) | 404 |
| `ReportGenerationException` (compile / fill / export failure) | 502 |

Reports are a **read** action and carry no `@PreAuthorize` — any authenticated
FSPTS role (including Reviewer / View roles) may run them, consistent with the
rest of the GET surface.

The frontend page is `pages/JcrsReports/` (an accordion of report forms;
catalog in `reportDefinitions.ts`).

## Adding a report

1. Add the `.jrxml` (and any subreports) under `src/main/resources/reports/`.
2. Add a `FspReportDefinition` enum value whose `name()` matches the JRXML
   filename, with a stable API id and a filename base.
3. Add a parameter builder in `FspReportParameterProvider` mapping the request
   to the template's `<parameter>` names.
4. Add the report to the frontend `reportDefinitions.ts` with its required
   fields.

## Caveats

- **Legacy JRXMLs reference JasperServer.** Some templates ported from the old
  system reference `com.jaspersoft.jasperserver.api.*` classes that only exist
  inside JasperReports Server. Those must be scrubbed before the template
  compiles embedded; until then they fail to compile and 502 at request time
  (logged at startup).
- **`SUBREPORT_DIR` needs an exploded classpath.** It's derived from a `file:`
  URL for `reports/`. Packaging that nests the resources inside a jar yields a
  `jar:` URL Jasper can't use as a directory — keep report resources reachable
  as files in the deployed image.
