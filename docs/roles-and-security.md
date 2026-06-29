# Roles & Security

Authorization in FSPTS has three layers, all derived from the caller's Cognito
JWT:

1. **Authentication** — the request carries a valid Cognito *access* token with
   at least one FSPTS role.
2. **Role capability** — does this role perform this *kind* of action at all?
   (e.g. edit content, take a workflow decision, administer.)
3. **Per-FSP ownership** — may this user touch *this particular* FSP? (Scopes
   Submitters to their own org.)

The frontend hides affordances accordingly, but **the backend is the source of
truth** — every layer is enforced server-side.

## The six roles

Roles are Cognito groups, canonical name `FSPTS_*` (an org suffix like
`_DPG` is allowed and matched). Defined in
`backend/.../security/FsptsRoles.java` and `frontend/src/context/auth/types.ts`.

| Role | Content edit | Amend / Extend / Replace | Workflow actions | Administration | FSP visibility |
|------|:---:|:---:|:---:|:---:|---|
| **Administrator** | ✅ — except `APP`/`INE`/`SUB` | ✅ | ✅ (any status) | ✅ | all |
| **Decision Maker** | ❌ | ❌ | ✅ (`SUB`/`OHS` only) | ❌ | all |
| **Submitter** | ✅ *(own org)* — `DFT` only | ✅ *(own org)* — `APP`/`INE` | ❌ | ❌ | own org's FSPs |
| **Reviewer** | ❌ | ❌ | ❌ (sees Workflow tab read-only) | ❌ | all |
| **View All** | ❌ | ❌ | ❌ | ❌ | all approved / in-effect |
| **View Only** | ❌ | ❌ | ❌ | ❌ | own org's approved |

### Menu / page access

| Menu | Admin | Decision Maker | Reviewer | View All | Submitter | View Only |
|------|:--:|:--:|:--:|:--:|:--:|:--:|
| FSP Search · Inbox · Reports | ✅ | ✅ | ✅ | ✅ | — | — |
| Submit FSP (Data Submission) | ✅ | — | — | — | ✅ | — |
| District Notification | ✅ | — | — | — | — | — |
| Standards Search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Submission History | — | — | — | — | ✅ | ✅ |

Menu visibility is declared per-entry in `routePaths.ts` (`roles`); the same map
gates direct page loads via `access.isPathAllowedForUser`. The per-status edit
rules live in `access.canEditFsp` (frontend) and are enforced server-side by
`FspAccessGuard.assertContentEditable` on the content-write paths (FSP info,
attachments, stocking standards, FDU) — Amend/Extend/Replace are a separate
flow and are intentionally **not** gated by it.

"Content edit" = plan information, attachments, stocking standards, FDU
licences, extension requests, and the Submit / Amend / Replace / Delete header
actions.

## No role stacking — one effective role

A user resolves to a **single effective role**; capabilities are never the
union of several roles. Precedence, highest first:

```
Administrator > Decision Maker > Reviewer > View All > Submitter > View Only
```

- The four **internal** roles (Administrator / Decision Maker / Reviewer /
  View All) are mutually exclusive, and a user is never both an internal role
  and a client-tied one.
- The two **client-tied** roles (Submitter / View Only) are held per forest
  client. A user party to multiple clients selects one **active client** (the
  org picker / `X-FSPTS-Active-Org-Client-Number` header) and is scoped to the
  role they hold *for that client*.

This is resolved once in **`RequestUtil.getEffectiveRole()`** (backend) and
mirrored by **`authUtils.highestRole()`** (frontend). Every downstream check
derives from it:

- **`CognitoGroupsAuthoritiesConverter`** grants only `ROLE_FSPTS_<effective>`,
  so the `@PreAuthorize` matrix sees one role.
- **`RequestUtil.getCurrentLegacyRoles()`** emits one `FSP_*` role to the
  legacy procs — removing the `INSTR`-substring stacking ambiguity (e.g. the
  View-All vs Reviewer disagreement between `get_search_criteria` and
  `user_may_access`).
- `isCurrentUser*` predicates and the frontend `user.roles` are single-valued.

> **Legacy caveat.** In the search proc `FSP_100_SEARCH.get_search_criteria`,
> the `FSP_VIEW_ALL` branch restricts to `APP/INE`, while Reviewer / Decision
> Maker fall through to the `1 = 1` (all-status) branch — the proc's comment
> ("VIEW_ALL, REVIEWER, DECISION MAKER → only approved") describes intent, not
> the code. With a single effective role this is now unambiguous: **Reviewer
> sees all statuses; View All sees only approved/in-effect.**

## Layer 2 — role capability (the matrix in code)

### Backend

The matrix lives in **`security/FspAuthorities.java`** as `@PreAuthorize`
expressions, applied to every write endpoint:

| Constant | Roles | Guards |
|----------|-------|--------|
| `CONTENT_EDIT` | Administrator, Submitter | FSP update/submit/delete/amend/replace, standards, attachments, FDU licences, extensions, the submission upload |
| `WORKFLOW_DECISION` | Administrator, Decision Maker | `POST /workflow/action` |
| `ADMINISTRATOR` | Administrator | district-notification designate add/remove |

Read (`GET`) endpoints stay open to any authenticated FSPTS role. A denied
write returns **403**.

> **Decision Maker status scoping.** `WORKFLOW_DECISION` is role-level. The
> rule "Decision Makers act only while a plan is in review" is layered on in
> `WorkflowService.submitAction`: a non-admin DDM is rejected (fail-closed)
> unless the FSP status is `SUB` or `OHS`. Administrators have no status
> restriction.

### Frontend

The same matrix is mirrored as predicates in **`src/routes/access.ts`** so the
UI hides what the backend would reject:

| Predicate | Meaning |
|-----------|---------|
| `canEditFspContent(user)` | Administrator or Submitter |
| `canActionWorkflow(user)` | Administrator or Decision Maker |
| `isAdministrator(user)` | Administrator |
| `canEditFsp(user, status)` | content edit, minus the Submitter-on-`SUB` lock |
| `canSeeWorkflowTab(user)` | everyone except Submitter-only (read-only for non-actors) |
| `isPathAllowedForUser(user, path)` | route guard — `/data-submission` needs content edit, `/admin/*` needs Administrator |

Nav visibility is gated per-entry in `routePaths.ts` (e.g. Data Submission →
`[Administrator, Submitter]`, District Notification → `[Administrator]`). The
Workflow tab's per-action buttons are gated in `WorkflowDataTab.tsx` by the
backend-projected workflow roles **and** the FSP status.

## Layer 3 — per-FSP ownership fence

Role capability says a Submitter *may edit FSP content*; the ownership fence
says *which* FSPs. It delegates to the legacy
`THE.FSP_TOMBSTONE.user_may_access(fsp_id, amendment, client_number, role)`
function, which returns `'Y'`/`'N'`:

- Administrator / Decision Maker / Reviewer → any FSP.
- View All → approved / in-effect / retired.
- **Submitter → only FSPs their org is an agreement holder on** (or, matching
  legacy, when no active-org client number is set).
- View Only → agreement-holder **and** approved.

**`security/FspAccessGuard.java`** makes this explicit and uniform.
`assertWritable(fspId, amendmentNumber)` calls `user_may_access` with the
caller's active-org client number (`RequestUtil.getCurrentClientNumber()`) and
legacy roles, and throws `fsp.web.error.no_access_right` (→ **403**) on `'N'`.

It's called at the top of every write that didn't already fence via a proc
round-trip: attachment upload/delete, all standards-regime writes, and FSP
amend/replace/delete. (FSP update/submit fence via their `GET`; FDU /
extension / standards-delete thread the client number to procs that fence
internally.) The guard fails closed — any error resolving access is a denial.

> The client number comes from the **active-org header** that BCeID submitters
> send. A submitter with no client number is treated as a trusted org user by
> the legacy proc (`p_user_client_number IS NULL → 'Y'`); the fence relies on
> the active-org being set, as the BCeID access model requires.

## How a denial maps to HTTP

Both proc-raised and guard-raised denials surface as `StoredProcedureException`
carrying a code; `exception/ProcErrorMessages.java` maps it:

| Proc code | HTTP |
|-----------|------|
| `fsp.web.error.no_access_right` | 403 |
| `FSP.INVALID.AGREEMENT.HOLDER` | 403 |
| `@PreAuthorize` denial (Spring Security) | 403 |

## Tests

- **Backend** — `FspApiControllerTest` (role gates per endpoint),
  `WorkflowServiceDdmGuardTest` (DDM review-phase status), `FspAccessGuardTest`
  (ownership fence → 403).
- **End-to-end** — `frontend/e2e/reviewer-enforcement.spec.ts` decodes the
  session's role off the bearer and asserts a direct write is denied (read-only)
  or allowed (editor) against the real stack.

## Adding or changing a role rule

1. Update the matrix in `FspAuthorities.java` (backend) and the predicates in
   `access.ts` (frontend) together — they must agree.
2. If the rule is status-aware, add it to the relevant service
   (`WorkflowService`) and the `WorkflowDataTab` gates.
3. If it's about *which* FSPs, it belongs in the ownership fence
   (`user_may_access` / `FspAccessGuard`), not the role matrix.
4. Add/adjust the controller test and, for read-only vs editor behavior, the
   e2e enforcement spec.
