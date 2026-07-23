# FSP dates

Every date attached to a Forest Stewardship Plan, reconciled across three
sources:

- **DB** — the actual Oracle columns + their comments (`nr-mof-db`, `THE` schema).
- **API/SPA** — the field name this codebase uses and where the date shows up.
- **Legacy** — the user-facing label / online-help definition from the old
  Struts app (`nr-fsp`), used to confirm meaning.

All dates are stored as Oracle `DATE`; the procs pre-format them to
`YYYY-MM-DD` via `fsp_common.convert_to_char`, and the SPA reformats for
display. The `*_timestamp` columns and the OTBH dates also carry a time.

---

## Core plan dates — `FOREST_STEWARDSHIP_PLAN`

DDL: `nr-mof-db/scripts/THE/TABLES/V2.01226__FOREST_STEWARDSHIP_PLAN.sql`

| Date | DB column | What it's for | API field | Legacy label |
|------|-----------|---------------|-----------|--------------|
| **Effective / Start** | `plan_start_date` | "The date the FSP comes into legal effect. Set by the FSP Decision Maker." | `planStartDate` / `effectiveDate` | "FSP Effective Date" |
| **Expiry / End** | `plan_end_date` | "The date the FSP expires" — derived from Effective + Term, or an explicit end date | `planEndDate` / `fspExpiryDate` | "FSP Expiry Date" |
| **Submission** | `plan_submission_date` (original) · `amendment_submission_date` (amendments) | Date the FSP / amendment was submitted to the district. Auto-set on submit; changeable by an authorized user | `planSubmissionDate` / `submissionDate` | "Submission Date" |
| **Decision** | `plan_decision_date` | "The date on which the original FSP or amendment is approved or rejected" (DDM determination) | `decisionDate` | "Decision Date" |
| **Amendment approval** | `amendment_approval_date` | "Date amendment approved by MoFR" | `approvalDate` | — |
| **Amendment effective** | (proc parameter; not a separate exposed column) | Effective date of an *amendment*, distinct from the plan start | `amendmentEfftvDate` | "Amendment Effective Date" |

- Set by `FSP_COMMON_DB` on status transitions — SUB fills the submission
  dates; APP/INE fill the decision/approval dates
  (`nr-mof-db/scripts/THE/PACKAGE_BODIES/V9.00202__FSP_COMMON_DB.sql`, the two
  `UPDATE forest_stewardship_plan` blocks).
- `plan_end_date` is recomputed from term via
  `ADD_MONTHS(plan_start_date, …)` in `FSP_300_INFORMATION`.
- `plan_start_date` is auto-stamped to `SYSDATE` if still null on save
  (`Fsp300InformationDaoImpl.setPlanStartDateIfNull`).

---

## Extension dates — `FSP_EXTENSION`

DDL: `nr-mof-db/scripts/THE/TABLES/V2.01285__FSP_EXTENSION.sql`

| Date | DB column | What it's for | API field | Legacy label |
|------|-----------|---------------|-----------|--------------|
| **Request / submission** | `submission_date` | "Date the extension was submitted by the plan holder" | `submissionDate` | **"Request Date"** |
| **Decision** | `decision_date` | "Date MoFR approves or rejects the extension" | `decisionDate` | "Decision Date" |
| **Approval** | `approval_date` | "Date extension approved by MoFR" | `approvalDate` | "Approval Date" |
| **Reject** | `reject_date` | "Date extension rejected by MoFR" | `rejectDate` | — |
| **New / extended expiry** | `plan_end_date` (on the extension) | The new expiry; **copied to the FSP** on approval | `planEndDate` / `newFspExpiryDate` | "New FSP Expiry Date" |
| **Extension effective** | `plan_start_date` (on the extension) | Date the approved extension takes effect; copied to the FSP | `planStartDate` / `effectiveDate` | "Effective Date" |

Extension **summary tombstone** (derived, from
`FSP_303_EXTENSION_SUMMARY.GET_LIST`):

- **Original effective** (`originalEffectiveDate`) and **Original expiry**
  (`originalExpiryDate`) — the FSP's *pre-extension* effective/expiry. The
  original expiry lives on `FOREST_STEWARDSHIP_PLAN.plan_end_date`, **not** on
  `FSP_EXTENSION`.
- **Current expiry** (`currentExpiryDate`) — expiry after any prior extensions.
- Legacy labels: "Original FSP Expiry Date" / "Current FSP Expiry Date".

---

## Opportunity-To-Be-Heard (OTBH) — in `FSP_STATUS_HISTORY`

- **OTBH Offered** (`offeredDate`) — date the OTBH was offered; sets status
  **OHS**. The proc rejects a future date (`FSP.BAD.OTBH.DATE`).
- **OTBH Heard** (`heardDate`) — date the hearing actually occurred; only valid
  from status OHS.

Both carry a wall-clock time so a same-day Offered → Heard sorts in order
(`WorkflowService.buildOtbhTimestamp`).

---

## History / audit timestamps

DDL: `nr-mof-db/scripts/THE/TABLES/V2.01299__FSP_STATUS_HISTORY.sql`

- **Event Date/Time** — `FSP_STATUS_HISTORY.entry_timestamp`: "the day and time
  the FSP status change was performed." It's the only date on that table and
  serves as both the *entry* and the *effective* status-change date. API:
  `eventDateTime` (history view) / `entryTimestamp` (review milestones). Legacy
  label: "Event Date/Time".
- **`entry_timestamp` / `update_timestamp`** on `FOREST_STEWARDSHIP_PLAN` and
  `FSP_EXTENSION` — system insert / last-update timestamps (pure audit).
- **`SUBMISSION_TIMESTAMP`** on `FSP_SUBMISSION` — when the plan arrived through
  the Electronic Submission Framework.

---

## Search filter (selects one of the above — nothing new is stored)

The FSP search's **Date type** dropdown + from/to range filters on whichever
date you pick: **Initiation / Decision / Effective / Expiry / Submitted**
(`FspSearchRequest.fspDateType` + `fspDateStart` / `fspDateEnd`; SPA
`SearchPage`). Legacy help (`Date_Type.htm`): "An FSP or amendment record may
be defined by … Decision Date, Effective Date, Expiry Date."

---

## Gotchas

1. **Effective/Expiry are shared columns.** An approved extension's effective
   (`plan_start_date`) and new expiry (`plan_end_date`) are **copied onto the
   FSP**, overwriting those columns — so the "current" expiry is just
   `plan_end_date`.
2. **Expiry is usually derived, not entered** — `plan_start_date` +
   `plan_term_years/months` via `ADD_MONTHS`, unless an explicit end date is
   supplied.
3. **Two "submission date" columns.** The search/workflow path reads
   `amendment_submission_date`; the Inbox reads `plan_submission_date`. Per
   record these mean "amendment submitted" vs "original plan submitted".
4. **Effective/Submission are NOT decision signals.** `get_ddm_only` always
   fills `effectiveDate`/`submissionDate` from
   `plan_start_date`/`amendment_submission_date` even *before* any decision —
   only `statusCode` + `decisionDate` indicate a real determination (the
   `WorkflowDataTab` code warns about this explicitly).
5. **Everything is Oracle `DATE`** (formatted to `YYYY-MM-DD`); only the
   `*_timestamp` columns and the OTBH dates carry a time component.
