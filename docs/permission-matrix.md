# FSPTS Permission Matrix — by activity **and** FSP status

> **Draft for client confirmation.** This restates the permission model with the
> **FSP status made explicit** (e.g. *Edit attachments — Draft* vs *— Submitted*),
> because most rules depend on what state the plan is in. Cells marked **❓** are
> our current assumption — please confirm or correct. For how each rule is
> enforced in the system (and which are not yet wired up), see
> [roles-and-security.md](roles-and-security.md).

## Legend

| Symbol | Meaning |
|:--:|---|
| ✅ | Permitted |
| ✅ (org) | Permitted, but only for FSPs owned by the user's **own organization** |
| — | Not permitted |
| ❓ | Assumption — please confirm |

## Roles

| Role | Who | Org-scoped? |
|------|-----|:--:|
| **Admin** (Administrator) | System administrator (IDIR) | No — all orgs |
| **DM** (Decision Maker) | Ministry decision maker / DDM (IDIR) | No — all orgs |
| **Reviewer** | Ministry reviewer (IDIR) | No — all orgs |
| **View All** | Read-only ministry viewer (IDIR) | No — all orgs |
| **Submitter** | Industry submitter (BCeID) | **Yes** — own org |
| **View Only** | Read-only industry viewer (BCeID) | **Yes** — own org |

A user has exactly **one** effective role (no stacking).

## FSP statuses

| Code | Status | Where it sits in the lifecycle |
|------|--------|--------------------------------|
| **DFT** | Draft | Being prepared; not yet submitted |
| **SUB** | Submitted | Awaiting ministry decision |
| **OHS** | Opportunity to be Heard | DDM has offered the submitter a chance to be heard |
| **APP** | Approved | Approved; awaiting effective date |
| **INE** | In Effect | Approved and active |
| **REJ** | Rejected | Decision was to reject |

*(End-of-life states — Cancelled, Retired, Expired, Deleted — are terminal and
read-only for everyone; omitted below.)*

---

## A. View / open an FSP

| FSP status | Admin | DM | Reviewer | View All | Submitter | View Only |
|------------|:--:|:--:|:--:|:--:|:--:|:--:|
| Draft (DFT) | ✅ | ✅ | ✅ | ✅ ❓ | ✅ (org) | ✅ (org) ❓ |
| Submitted (SUB) | ✅ | ✅ | ✅ | ✅ ❓ | ✅ (org) | ✅ (org) ❓ |
| Opp. to be Heard (OHS) | ✅ | ✅ | ✅ | ✅ ❓ | ✅ (org) | ✅ (org) ❓ |
| Approved (APP) | ✅ | ✅ | ✅ | ✅ | ✅ (org) | ✅ (org) |
| In Effect (INE) | ✅ | ✅ | ✅ | ✅ | ✅ (org) | ✅ (org) |
| Rejected (REJ) | ✅ | ✅ | ✅ | ✅ ❓ | ✅ (org) | ✅ (org) ❓ |

*Question 1: today View All / View Only only see Approved & In-Effect plans.
Should they also **view** (read-only) in-progress plans (Draft/Submitted/OHS/
Rejected) — View Only limited to their own org? The ❓ cells assume "yes."*

---

## B. Edit content

### B1. Edit plan information · spatial (FDU) · stocking standards

| FSP status | Admin | DM | Reviewer | View All | Submitter | View Only |
|------------|:--:|:--:|:--:|:--:|:--:|:--:|
| Draft (DFT) | ✅ | — | — | — | ✅ (org) | — |
| Submitted (SUB) | ✅ | — | — | — | — | — |
| Opp. to be Heard (OHS) | ✅ | — | — | — | — | — |
| Approved (APP) | ✅ | — | — | — | — | — |
| In Effect (INE) | ✅ | — | — | — | — | — |
| Rejected (REJ) | ✅ | — | — | — | — ❓ | — |

#### B1a. Stocking standards — per-standard row actions

The stocking-standards table's row buttons (**Add**, **Copy**, **Delete**,
**Unlink default**) inherit the B1 content-edit gate above: on a **Draft (DFT)**
plan/amendment an **Administrator** or the owning **Submitter** may use them; on
any other status only an Administrator may; nobody may on a terminal state
(CAN / RET / EXP / DEL). Which of Delete vs Unlink appears depends on the
**selected standard's type** — a standard is either a draft or a MoF default,
never both:

| Row action | Appears when the selected standard is… | Admin | Submitter |
|------------|----------------------------------------|:--:|:--:|
| Add existing / new standard | *(n/a — acts on the list)* | ✅ any non-terminal | ✅ **Draft only** (org) |
| Copy standard | a **draft** | ✅ | ✅ **Draft only** (org) |
| **Delete** standard | a **draft** | ✅ | ✅ **Draft only** (org) |
| **Unlink** default standard | a **MoF default** | ✅ | ✅ **Draft only** (org) |

So **Delete and Unlink are both available to a Submitter whenever the FSP or
amendment being viewed is in Draft** (and the selected standard is the matching
type). This mirrors legacy FSP550 `StandardsButtonManager.getEnableDelete` /
`get250UnlinkEnabled`, whose FSP-level gate is Draft-for-Submitter /
any-non-terminal-for-Admin; the proc re-validates the selected regime's own
status server-side. Enforced in the frontend `StockingStandardsTab`
(`canDelete` / `canUnlink`, both AND-ed with `canEditFsp`) and re-checked by the
backend on the unlink/delete calls.

### B2. Edit / upload **attachments**

| FSP status | Admin | DM | Reviewer | View All | Submitter | View Only |
|------------|:--:|:--:|:--:|:--:|:--:|:--:|
| Draft (DFT) | ✅ | ✅ | ✅ | — | ✅ (org) | — |
| Submitted (SUB) | ✅ | ✅ | ✅ | — | ✅ (org) | — |
| Opp. to be Heard (OHS) | ✅ | ❓ | ❓ | — | ❓ | — |
| Approved (APP) | ✅ | — | — | — | — | — |
| In Effect (INE) | ✅ | — | — | — | — | — |
| Rejected (REJ) | ✅ | ❓ | ❓ | — | ❓ | — |

*Question 2: attachments are editable by Decision Maker, Reviewer, and Submitter
while **Draft** and **Submitted**. Should that also extend to **OHS** and
**Rejected**? Administrator can edit content (incl. attachments) in **any**
status.*

*Question 3: on a **Rejected** plan, may the Submitter edit content/attachments
before resubmitting, or only resubmit as-is?*

---

## C. Lifecycle actions

These are one-shot actions gated by the plan's current status.

| Action | Requires status | Admin | DM | Reviewer | View All | Submitter | View Only |
|--------|-----------------|:--:|:--:|:--:|:--:|:--:|:--:|
| Create new draft FSP | *(new)* | ✅ | — | — | — | ✅ (org) | — |
| Submit for decision | DFT | ✅ | — | — | — | ✅ (org) | — |
| Resubmit | REJ | ✅ | — | — | — | ✅ (org) | — |
| Amend | APP / INE | ✅ | — | — | — | ✅ (org) | — |
| Replace | APP / INE | ✅ | — | — | — | ✅ (org) | — |
| Extend (request) | APP / INE | ✅ | — | — | — | ✅ (org) | — |
| Delete | DFT (or REJ) | ✅ | — | — | — | ✅ (org, own) | — |

---

## D. Workflow decisions

| Action | Requires status | Admin | DM | Reviewer | View All | Submitter | View Only |
|--------|-----------------|:--:|:--:|:--:|:--:|:--:|:--:|
| Record review milestone (FNR / RS / ORS / Other) | SUB | ✅ | ✅ | ✅ | — | — | — |
| Add review comments | SUB | ✅ | ✅ | ✅ | — | — | — |
| Offer Opportunity to be Heard | SUB, APP | ✅ | ✅ | — | — | — | — |
| Record OTBH heard | OHS | ✅ | ✅ | — | — | — | — |
| **Approve** | SUB | ✅ | ✅ | — | — | — | — |
| **Reject** | SUB | ✅ | ✅ | — | — | — | — |
| Reject an approved / in-effect plan | APP / INE | ✅ | — | — | — | — | — |
| Request clarification (send back to Draft) | SUB | ✅ | ✅ | — | — | — | — |
| Reverse approval (back to Submitted) | APP | ✅ | — | — | — | — | — |
| Revert to Draft | INE | ✅ | — | — | — | — | — |
| Extension decision (approve / reject) | extension open | ✅ | ✅ | — | — | — | — |
| Extension decision once approved / rejected | — | ✅ | — | — | — | — | — |

---

## E. Administration

| Action | Admin | DM | Reviewer | View All | Submitter | View Only |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|
| District Notification — add / remove designate | ✅ | — | — | — | — | — |

---

## Open questions for the client

1. **In-progress visibility (Section A).** Should View All (all orgs) and View
   Only (own org) be able to **view** Draft / Submitted / OHS / Rejected plans
   read-only? Today they only see Approved & In-Effect.
2. **Attachment edit window (B2).** Confirmed for Draft & Submitted (Admin / DM /
   Reviewer / Submitter). Extend to **OHS** and **Rejected** too?
3. **Editing a Rejected plan (B1 / B2).** May a Submitter edit before resubmit,
   or resubmit unchanged only?
4. **Administrator scope (B1 / B2).** Confirm Admin may edit **all** content in
   **any** status, including Approved / In-Effect.
5. **Submitter scope (B1).** Confirm Submitter edits general content (info /
   spatial / standards) only while **Draft** — with attachments the sole
   exception, extending into **Submitted**.
6. **Cross-org edits by ministry roles (B2).** Decision Maker / Reviewer are not
   org-scoped — confirm they may edit attachments on **any** organization's plan.
