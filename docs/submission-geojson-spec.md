# Forest Stewardship Plan (FSP) — GeoJSON Submission Specification

**Audience:** Licensees and third-party GIS vendors preparing FSP spatial submissions
**Status:** Current
**Format version:** 1.0

---

## 1. Overview

The FSP submission system accepts spatial submissions as a single **GeoJSON `FeatureCollection`**. One file carries:

- **Plan header information** (plan name, term, agreement holders, districts, contact, etc.) as a custom `fsp` member on the FeatureCollection.
- **Spatial features** — Forest Development Unit (FDU) polygons and Identified Area polygons — as standard GeoJSON `Feature` objects, each tagged with an `fspEntityType` so the system knows how to route it.

The GeoJSON format is functionally equivalent to the legacy XML submission format; either is accepted. This document describes the GeoJSON option only.

> **At a glance:** a standard `FeatureCollection`, plus one `fsp` object for the plan header, plus one `fspEntityType` property on every feature.

---

## 2. File format and encoding

| Item | Requirement |
|------|-------------|
| Media | A single GeoJSON (`.json` / `.geojson`) text file |
| Encoding | UTF-8 (a leading byte-order mark is tolerated) |
| Format detection | The first non-whitespace character must be `{` (a JSON object). Files beginning with `<` are treated as the legacy XML format. |
| Maximum file size | **100 MB** per file |
| Unknown fields | Ignored. Extra keys not listed in this spec will not cause a failure, so files may carry vendor metadata safely. |

---

## 3. Top-level structure

The root document is a GeoJSON `FeatureCollection` with one FSP-specific extension member, `fsp`.

```json
{
  "type": "FeatureCollection",
  "crs": { "type": "name", "properties": { "name": "EPSG:3005" } },
  "fsp": { "...plan header...": "see Section 5" },
  "features": [ "...Feature objects...": "see Section 7" ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | string | **Yes** | Must be exactly `"FeatureCollection"`. |
| `crs` | object | Recommended | Coordinate reference system. See Section 4. |
| `fsp` | object | **Yes** | Plan-level header. See Section 5. |
| `features` | array | **Yes** | The FDU and Identified Area features. May be empty only if the submission genuinely has no spatial content. |

---

## 4. Coordinate reference system (`crs`)

Coordinates must be supplied in **BC Albers, `EPSG:3005`** (the provincial standard projection; units are metres).

```json
"crs": {
  "type": "name",
  "properties": { "name": "EPSG:3005" }
}
```

- The system reads the projection name from `crs.properties.name`.
- All coordinate pairs are interpreted as `[easting, northing]` (i.e. `[x, y]`) in that projection.
- If `crs` is omitted, no projection name is attached to the geometry; **always include it** to avoid ambiguity.

---

## 5. Plan header — the `fsp` member

A single object carrying the plan-level fields that have no place inside per-feature properties.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fspId` | string (numeric) | Conditional | The existing FSP identifier. **Omit for a brand-new (initial) plan**; **required** when updating or amending an existing plan. Must contain digits only. |
| `planName` | string | **Yes** | The plan name. |
| `actionCode` | string | **Yes** | Submission intent. One of `I`, `U`, `A`, `R`. See Section 9. |
| `amendmentName` | string | No | Licensee's name for the amendment. |
| `amendmentComment` | string | No | Free-text description of the amendment. |
| `amendmentApprovalRequired` | boolean | No | Whether the amendment requires ministry approval. |
| `submissionMetadata` | object | No* | Contact details. See Section 6. *If present, some sub-fields become required. |
| `planHolders` | array of string | **Yes** | One or more agreement-holder **client numbers**. At least one is required, and they must be unique. |
| `districts` | array of string | **Yes** | One or more **district codes**. At least one is required; each must exist and be unique. |
| `planTermYears` | integer | No | Plan term, whole years. |
| `planTermMonths` | integer | No | Plan term, additional months. |
| `frpa197` | boolean | No | FRPA s.197 election indicator. |
| `transitional` | boolean | No | Transitional plan indicator. Defaults to `false` when omitted. |
| `legalDocConsolidated` | boolean | No | Legal document consolidated indicator. |
| `fduUpdate` | boolean | No | Marks that FDUs changed in this submission. |
| `identifiedAreasUpdate` | boolean | No | Marks that identified areas changed in this submission. |
| `stockingStandardsUpdate` | boolean | No | Marks that stocking standards changed in this submission. |

---

## 6. Contact details — `submissionMetadata`

Optional, but **if you include the object, `contactName` and `emailAddress` are required.**

```json
"submissionMetadata": {
  "contactName": "Jane Forester",
  "telephoneNumber": "250-555-0144",
  "emailAddress": "jane.forester@example.com",
  "attachmentCount": 0
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contactName` | string | **Yes** (if metadata present) | Submitter / licensee contact name. |
| `emailAddress` | string | **Yes** (if metadata present) | Contact email. |
| `telephoneNumber` | string | No | Contact phone. |
| `attachmentCount` | integer | No | Number of accompanying attachments. |

---

## 7. Spatial features (`features`)

Every entry is a standard GeoJSON `Feature`. The system distinguishes feature kinds using a **required** `fspEntityType` property.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | **Yes** | Standard GeoJSON value `"Feature"`. |
| `geometry` | object | **Yes** | A `Polygon` or `MultiPolygon`. See Section 8. |
| `properties` | object | **Yes** | Must include `fspEntityType` and `name`; other keys depend on the entity type. |

### Common properties (all features)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `fspEntityType` | string | **Yes** | Routing discriminator. One of `FDU` or `IDENTIFIED_AREA`. |
| `name` | string | **Yes** | Non-blank name for the feature. Names must be unique within their entity type. |

### 7a. FDU features (`fspEntityType: "FDU"`)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | **Yes** | FDU name (unique among FDUs). |
| `licenceNumbers` | array of string | No | Associated forest-use licence numbers. Each is validated against the provincial forest-use registry; unknown numbers are rejected. |

```json
{
  "type": "Feature",
  "properties": {
    "fspEntityType": "FDU",
    "name": "FDU-001",
    "licenceNumbers": ["A12345", "A67890"]
  },
  "geometry": { "type": "Polygon", "coordinates": [ /* ... */ ] }
}
```

### 7b. Identified Area features (`fspEntityType: "IDENTIFIED_AREA"`)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | **Yes** | Identified area name (unique among identified areas). |
| `legislationTypeCode` | string | **Yes** | The governing legislation. One of `FRPA196(1)`, `FRPA196(2)`, `FPPR14(4)`. See Section 9. |

```json
{
  "type": "Feature",
  "properties": {
    "fspEntityType": "IDENTIFIED_AREA",
    "name": "Community Watershed A",
    "legislationTypeCode": "FRPA196(1)"
  },
  "geometry": { "type": "MultiPolygon", "coordinates": [ /* ... */ ] }
}
```

---

## 8. Geometry rules

Only **`Polygon`** and **`MultiPolygon`** geometries are supported. Points, lines, and other geometry types are rejected.

### Coordinate structure

- A **position** is an array of at least two numbers: `[x, y]` (easting, northing in EPSG:3005). Additional ordinates (e.g. a Z value) are permitted but ignored.
- A **linear ring** is an array of positions. It must contain **at least 4 positions**, and per GeoJSON (RFC 7946) the first and last positions must be identical (closed ring).
- A **`Polygon`** is an array of rings: the **first ring is the outer boundary**; any **subsequent rings are interior holes**.
- A **`MultiPolygon`** is an array of polygons (each polygon being an array of rings).

```json
"geometry": {
  "type": "Polygon",
  "coordinates": [
    [ [1200000, 460000], [1200500, 460000], [1200500, 460500], [1200000, 460500], [1200000, 460000] ]
  ]
}
```

### Ring orientation (winding)

Winding order is **normalized automatically** on import (outer rings to counter-clockwise, holes to clockwise, as required by Oracle Spatial). You do **not** need to pre-correct orientation, though following the RFC 7946 right-hand rule is encouraged.

### Geometry validity

Geometries are validated for spatial correctness after import. Self-intersections, unclosed rings, and similar defects will be reported as errors.

---

## 9. Reference code lists

### Action codes (`fsp.actionCode`)

| Code | Meaning | `fspId` |
|------|---------|---------|
| `I` | Initial — a new plan | Omit |
| `U` | Update — revise an existing draft | Required |
| `A` | Amendment — amend an approved/in-effect plan | Required |
| `R` | Replacement — replace an approved/in-effect plan | Required |

> For `A` (amendment) and `R` (replacement), the referenced FSP must already have an **approved or in-effect** amendment, or the submission is rejected. Replacement submissions **always require ministry approval** and supersede the prior approved amendment.

### Legislation type codes (`legislationTypeCode`, Identified Areas only)

| Code | Reference |
|------|-----------|
| `FRPA196(1)` | Forest and Range Practices Act, s.196(1) |
| `FRPA196(2)` | Forest and Range Practices Act, s.196(2) |
| `FPPR14(4)` | Forest Planning and Practices Regulation, s.14(4) |

Codes must be written **exactly** as shown (no spaces).

---

## 10. Validation and error handling

When a submission is uploaded it is validated in full and **all** problems are reported together (not one at a time), so you can correct everything in a single pass. A parsed **preview** of what was read is returned alongside any errors.

Validation covers, among others:

- **Structure** — root is a `FeatureCollection`; the `fsp` header is present; required fields are populated; enumerated values are valid.
- **Plan header** — `planName` present; `actionCode` valid; at least one `planHolder`; at least one `district` (each must exist and be unique).
- **Features** — every feature has a valid `fspEntityType`, a non-blank `name`, and a geometry; identified areas carry a valid `legislationTypeCode`; FDU and identified-area names are unique within their type.
- **FDU licences** — every `licenceNumbers` entry exists in the provincial forest-use registry.
- **Context** — for `A`/`R`, the referenced FSP must exist and have an approved or in-effect amendment to build on.
- **Geometry** — supported type, well-formed rings, spatial validity.

Each error identifies the offending location using a path such as `features[3].properties.legislationTypeCode` or `fsp.planHolders`, making it straightforward to locate in your file.

---

## 11. Complete example

```json
{
  "type": "FeatureCollection",
  "crs": {
    "type": "name",
    "properties": { "name": "EPSG:3005" }
  },
  "fsp": {
    "planName": "Example Forest Stewardship Plan",
    "actionCode": "I",
    "amendmentApprovalRequired": false,
    "submissionMetadata": {
      "contactName": "Jane Forester",
      "telephoneNumber": "250-555-0144",
      "emailAddress": "jane.forester@example.com",
      "attachmentCount": 0
    },
    "planHolders": ["00012345"],
    "districts": ["DCK"],
    "planTermYears": 5,
    "planTermMonths": 0,
    "transitional": false
  },
  "features": [
    {
      "type": "Feature",
      "properties": {
        "fspEntityType": "FDU",
        "name": "FDU-001",
        "licenceNumbers": ["A12345"]
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [1200000, 460000],
            [1200500, 460000],
            [1200500, 460500],
            [1200000, 460500],
            [1200000, 460000]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "fspEntityType": "IDENTIFIED_AREA",
        "name": "Community Watershed A",
        "legislationTypeCode": "FRPA196(1)"
      },
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": [
          [
            [
              [1201000, 461000],
              [1201400, 461000],
              [1201400, 461400],
              [1201000, 461400],
              [1201000, 461000]
            ]
          ]
        ]
      }
    }
  ]
}
```

---

## 12. Pre-submission checklist

- [ ] Root `type` is `"FeatureCollection"`.
- [ ] `crs` names `EPSG:3005` and all coordinates are BC Albers eastings/northings.
- [ ] `fsp.planName` and `fsp.actionCode` are set; `actionCode` is `I`, `U`, `A`, or `R`.
- [ ] `fspId` is present for `U`/`A`/`R` and absent for `I`.
- [ ] At least one `planHolder` client number and one `district` code, each unique.
- [ ] If `submissionMetadata` is included, `contactName` and `emailAddress` are set.
- [ ] Every feature has `fspEntityType` (`FDU` or `IDENTIFIED_AREA`) and a unique, non-blank `name`.
- [ ] Every Identified Area has a valid `legislationTypeCode`.
- [ ] All FDU `licenceNumbers` are real provincial forest-use licence numbers.
- [ ] Every geometry is a `Polygon` or `MultiPolygon`; each ring has ≥4 closed positions.
- [ ] File is UTF-8 and under 100 MB.
