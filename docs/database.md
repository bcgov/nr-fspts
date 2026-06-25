# Database & Stored-Procedure Integration

## Where the data and logic live

FSPTS uses the shared BC Gov Oracle database (`THE` schema) — the same data
the legacy FSP app used. The application **does not** define tables, run
migrations, or contain an ORM. Instead it calls **legacy PL/SQL packages**, and
those packages own the schema, the business rules, and the transitions.

There is **no DB container** for local dev. The backend connects directly to
the shared Oracle over the BC Gov VPN, using a truststore
and credentials supplied via the gitignored `application-local.yml`.

## The packages this app calls

| Package | Used for |
|---------|----------|
| `FSP_100_SEARCH` | FSP search |
| `fsp_200_inbox` | Inbox |
| `FSP_300_INFORMATION` | FSP header: get / save / submit / amend / replace / remove |
| `FSP_302/303_EXTENSION_*` | Extension requests + summary |
| `FSP_400_ATTACHMENTS` | Attachments (create / content / blob / remove) |
| `FSP_500 / FSP_550 / FSP_501` | Stocking standards (regime, sub-layers, sub-species, search) |
| `FSP_600_MAP / FSP_650_IDENTIFIED_AREAS_MAP` | FDU + identified-area geometry |
| `FSP_700_WORKFLOW` | Review milestones, OTBH, DDM decision, extension decisions |
| `FSP_800_HISTORY` | Audit history |
| `FSP_TOMBSTONE` | Access resolution + the `user_may_access` ownership fence |
| `FSP_CODE_LISTS` | Dropdown code lists (org units, statuses, species, …) |
| `PKG_SIL21_CLIENT_SEARCH` | Agreement-holder (client) search → `FOREST_CLIENT` ⋈ `CLIENT_LOCATION` |
| `SIL_52_BGC_SEARCH_V003` | BGC zone search |

## The DAO pattern

Every DAO wraps a stored procedure, not a table. The shared plumbing lives in
`dao/v1/AbstractStoredProcedureDao`:

- `callSql(pkg, proc, paramCount)` builds the positional `{ call PKG.PROC(?,…) }`.
- `executeCall(...)` runs it, registering OUT cursors and reading rows.
- Helpers (`registerOutCursor`, `setInOutString`, `readCursor`, `nullIfBlank`)
  bind/read by **position** — legacy procs take dozens of positional params.

Things to know when working with these procs (hard-won; see code comments):

- **`P_ACTION` dispatch.** Several packages are one `MAINLINE` proc that
  branches on an action string. `FSP_300_INFORMATION.MAINLINE` handles
  `GET / SAVE / SUBMIT / AMEND / REPLACE / REMOVE`. Some procs expect `GET`
  (not `FETCH`).
- **Full-record SAVE.** `SAVE` expects the *entire* record on the wire, not a
  sparse diff — the service reads the current row (`GET`), overlays the edited
  fields, then saves. A sparse save trips `ORA-01403` inside the proc.
- **Roles + client number must be threaded.** Procs read `p_user_role`
  (legacy `FSP_*` format from `RequestUtil.getCurrentLegacyRoles()`) and
  `p_user_client_number` (the active-org client). Empty values can flip an
  access check to "no access".
- **Cursors read by position, not name**, for the code-list packages.
- **Amendment number matters.** Many `GET`/`SAVE` procs do an unguarded
  `SELECT INTO ... WHERE fsp_id = ? AND fsp_amendment_number = ?`; a missing
  amendment number raises `NO_DATA_FOUND` → a misleading "noRecord".

## Access fence — `user_may_access`

`FSP_TOMBSTONE.user_may_access(fsp_id, amendment, client_number, role)` returns
`'Y'`/`'N'` and is the single source of "may this user touch this FSP". It's
invoked both inside the tombstone `GET` (so reads fence) and directly by
`FspAccessGuard` (so every write fences). See
[roles-and-security.md](roles-and-security.md#layer-3--per-fsp-ownership-fence).

## Errors

Procs signal problems by raising `FSP.*` / `fsp.web.error.*` codes (via
`fsp_error`). The DAO surfaces them as `StoredProcedureException`, and
`exception/ProcErrorMessages.java` maps each code to an HTTP status + a curated,
user-facing message (a single source shared with the submit-preflight, which
reads the same codes back from `fsp_error.get_error_keys`). Unknown codes fall
back to 500 with the raw Oracle message.

## FSP status state machine

FSP statuses (`DFT`, `SUB`, `OHS`, `APP`, `INE`, `REJ`, `EXP`, `CAN`, `RET`,
`DEL`) and their allowed transitions are defined by the procs, not the app. A
detailed, source-referenced map lives at:

```
backend/src/main/resources/schemas/fsp/MOF/fsp-status-state-machine.md
```

Transitions are validated by `FSP_COMMON_VALIDATION.validate_status_change`;
replacement cascades (sibling amendments → `CAN`/`RET`) by
`FSP_COMMON_DB.fsp_status_cancel`.

## Caveats from the field

A few non-obvious DB realities are recorded in code comments and worth knowing:

- Some FSPs are visible to the legacy app's DB session but not to the API's
  proxy user — a DBA-side grant/proxy gap, not a code bug.
- BGC search has two same-named packages; FSP must use
  `SIL_52_BGC_SEARCH_V003.MAINLINE` (the one granted to FSP roles).
- The FSP-level **expiry date** shown in the header is derived by the tombstone
  from the last approved amendment's plan end date — it isn't a column the app
  writes on submit.
