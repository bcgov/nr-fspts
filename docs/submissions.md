# FSP Submissions

Licensees submit Forest Stewardship Plans as a single uploaded file, in one of
two formats:

- **XML** — bare `<fsp:fspSubmission>` or ESF-wrapped, validated against the
  MOF FSP XSD (`backend/src/main/resources/schemas/fsp/`).
- **GeoJSON** — a `FeatureCollection` with an `fsp` header member and
  `fspEntityType`-tagged features. The full client-facing contract is
  [submission-geojson-spec.md](submission-geojson-spec.md).

Both formats parse into the **same** JAXB tree (`FSPSubmissionType`), so all
downstream validation, preview, and persistence run identically.

## Pipeline

```
upload ──▶ detect format ──▶ parse ──▶ validate ──▶ preview ──┐
 (.xml/.json)   { → GeoJSON     (XSD /     (schema +   (what we   │
                 < → XML         GeoJSON)   geometry +  parsed)    │
                                            business)              ▼
                                                            persist (one
                                                            transaction)
```

- **Detect** — `SubmissionValidationService.detectFormat`: first non-whitespace
  byte `{` → GeoJSON, `<` → XML.
- **Validate (dry run)** — `POST /api/v1/fsp/submissions/validate` returns
  `valid: true` (200) or the full list of issues (422) without persisting.
  Validators cover XSD/shape, geometry validity, agreement holders, district
  codes, action-code context, licence numbers, plan term vs expiry, and FDU /
  identified-area name uniqueness.
- **Persist** — `POST /api/v1/fsp/submissions` validates again, then writes the
  FSP (header + FDUs + identified areas + stocking standards + attachments) in
  a single transaction. Geometry rings are normalized to the orientation Oracle
  Spatial requires.

Both endpoints require the **content-edit** capability (Administrator /
Submitter); see [roles-and-security.md](roles-and-security.md).

## Action codes

The submission's `actionCode` declares intent, mapped to the DB
`fsp_amendment_code`:

| `actionCode` | Meaning | DB |
|---|---|---|
| `I` | Initial — new plan | `ORG` |
| `U` | Update a draft | `ORG` |
| `A` | Amendment | `AMD` |
| `R` | Replacement | `RPL` |

For `A`/`R`, the referenced FSP must already have an approved/in-effect
amendment to build on, or the submission is rejected up front.

## Code map

| Concern | Code |
|---------|------|
| Orchestration | `submission/SubmissionValidationService` |
| XML parse | `submission/parser/SubmissionXmlParser` |
| GeoJSON parse | `submission/geojson/SubmissionGeoJsonParser` |
| Validators | `submission/validator/*` |
| Preview mapping | `submission/SubmissionPreviewMapper` |
| Persistence | `submission/persist/*` (FSP request mapper, FDU, identified areas, standards, attachments) |
| Geometry orientation | `submission/persist/GeometryOrientationNormalizer` |

Test fixtures live in `backend/src/test/resources/fixtures/submissions/` and
`frontend/e2e/fixtures/`.
