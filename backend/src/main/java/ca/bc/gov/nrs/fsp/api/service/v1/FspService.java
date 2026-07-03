package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp100SearchDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp300InformationDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.bean.LicenseeArrayElement;
import ca.bc.gov.nrs.fsp.api.dao.v1.bean.OrgUnitArrayElement;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Search via FSP_100_SEARCH.MAINLINE; fetch + update via fsp_300_information.MAINLINE.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FspService {

  // FSP_100_SEARCH.MAINLINE dispatches on P_ACTION. The legacy
  // Fsp100SearchAction.handleGet() passes "GET" — not the "FETCH" we
  // were sending. With the wrong action the proc executes a different
  // (or no-op) branch and the cursor comes back empty, which is the
  // "0 results" symptom regardless of the search criteria.
  private static final String ACTION_GET = "GET";
  private static final String ACTION_FETCH = "FETCH";
  // FSP_300_INFORMATION.MAINLINE only recognises GET/SAVE/REMOVE/AMEND/
  // CHANGE_AMEND/REPLACE/CHANGE_REPLACE/VIEW_*/SUBMIT — any other action
  // raises e_invalid_function_request. SAVE handles both insert (when
  // p_fsp_id IS NULL the proc calls fsp_common_db.fsp_create_new which
  // pulls from FSP_SEQ) and update (non-null fsp_id → in-place change).
  private static final String ACTION_SAVE = "SAVE";
  // AMEND creates a new draft amendment row for an existing FSP. The
  // proc auto-assigns the next amendment_number when we pass blank,
  // and copies forward licensee/org-unit/etc. from the prior amendment.
  // After AMEND, the body still needs a SAVE call to populate the new
  // amendment's plan-level fields with the submitted values.
  private static final String ACTION_AMEND = "AMEND";
  // REPLACE is the AMEND analogue for Replacement (FSP304 in the legacy
  // UI). The proc creates a new draft amendment row carrying
  // fsp_amendment_code='RPL' and seeds it with the carry-forward state
  // a Replacement needs (always-approval-required, etc.). Same SAVE
  // follow-up pattern as AMEND — REPLACE only inserts the skeleton; the
  // body fields land via a subsequent SAVE on the proc-assigned
  // amendment number. CHANGE_REPLACE updates an existing replacement
  // row before submission and isn't exposed yet — UI-side edits use
  // the regular SAVE path keyed by the assigned amendment.
  private static final String ACTION_REPLACE = "REPLACE";
  // SUBMIT transitions a DFT amendment to SUB (or directly to IN-EFFECT
  // when amendment_approval_requird_ind='N'). The proc runs
  // validate_fsp first — submission fails with collected business-rule
  // errors when the amendment is incomplete. Mirrors the legacy
  // Fsp300InformationAction.handleSubmit.
  private static final String ACTION_SUBMIT = "SUBMIT";
  // REMOVE hard-deletes the FSP row + all child records (attachments,
  // standards, FDUs, identified areas, etc.). The proc only allows
  // deletion when status is DFT or REJ — anything else raises
  // FSP.CANNOT.DEL.PREV.AMENDMENT (see fsp_common_db.fsp_delete:2576).
  // We additionally gate on DFT only at the FE so users can't delete
  // rejected FSPs through the UI (matches the spec).
  private static final String ACTION_REMOVE = "REMOVE";

  private final Fsp100SearchDao searchDao;
  private final ca.bc.gov.nrs.fsp.api.dao.v1.FspSearchDirectDao searchDirectDao;
  private final Fsp300InformationDao informationDao;
  private final ca.bc.gov.nrs.fsp.api.dao.v1.FspValidationDao validationDao;
  private final ca.bc.gov.nrs.fsp.api.security.FspAccessGuard accessGuard;
  private final ca.bc.gov.nrs.fsp.api.client.FomByFspClient fomClient;

  // When true (default), FSP search runs as a direct table query
  // (FspSearchDirectDao) instead of FSP_100_SEARCH.MAINLINE — see the
  // search-perf-investigation note. Flip to false to fall back to the
  // proc for instant rollback if the direct query ever diverges.
  @org.springframework.beans.factory.annotation.Value("${fsp.search.direct:true}")
  private boolean searchDirect;

  // Allow-listed sort keys. Maps the JSON field name the front-end sends
  // (sortBy) onto a Comparator over FspSearchResult. Kept narrow so
  // arbitrary input can't trigger a NullPointerException or sort by a
  // field the client wasn't supposed to know about. Any unknown sortBy
  // falls back to fspId.
  private static final Map<String, Function<FspSearchResult, String>> SORT_KEYS = Map.of(
      "fspId", FspSearchResult::getFspId,
      "planName", FspSearchResult::getPlanName,
      "fspAmendmentNumber", FspSearchResult::getFspAmendmentNumber,
      "fspAmendmentName", FspSearchResult::getFspAmendmentName,
      "orgUnitCode", FspSearchResult::getOrgUnitCode,
      "planStartDate", FspSearchResult::getPlanStartDate,
      "planEndDate", FspSearchResult::getPlanEndDate,
      "fspStatusDesc", FspSearchResult::getFspStatusDesc,
      "agreementHolder", FspSearchResult::getAgreementHolder
  );

  // Sort keys whose values are NUMBER in the DB but arrive as VARCHAR
  // in the REF CURSOR. Lex compare ranks "9001" > "10000" which is the
  // opposite of user expectation; numeric compare via toLong is right.
  private static final Set<String> NUMERIC_SORT_KEYS = Set.of(
      "fspId", "fspAmendmentNumber"
  );

  public PageableResponse<FspSearchResult> search(FspSearchRequest request) {
    // P_ENTRY_USER_ROLE — legacy handleGet pulled User.getUser_roles()
    // which returned a space-separated list. The MAINLINE proc uses it
    // to scope visible rows (admin/decision-maker see everything,
    // view-only gates to APP, etc.). Map our canonical FSPTS_* roles
    // onto the legacy FSP_* names the proc expects.
    String userRoles = RequestUtil.getCurrentLegacyRoles();
    String userClientNumber = RequestUtil.getCurrentClientNumber();
    int page = request.getPage() == null ? 0 : Math.max(0, request.getPage());
    int size = request.getSize() == null || request.getSize() <= 0 ? 10 : request.getSize();

    if (searchDirect) {
      // Direct table query — same row shape + visibility rules as the
      // proc, but pagination, ordering, and the count are pushed into SQL
      // so only the page's rows materialise their LISTAGG subqueries and
      // cross the VPN. See FspSearchDirectDao.
      var criteria = new ca.bc.gov.nrs.fsp.api.dao.v1.FspSearchDirectDao.SearchCriteria(
          nz(request.getFspId()),
          nz(request.getFspPlanName()),
          nz(request.getOrgUnitNo()),
          nz(request.getAhClientNumber()),
          nz(request.getFspAmendmentName()),
          nz(request.getFspDateStart()),
          nz(request.getFspDateEnd()),
          nz(request.getFspDateType()),
          nz(request.getFspStatusCode()),
          nz(request.getApprovalRequired()),
          userClientNumber,
          userRoles);
      var pageResult = searchDirectDao.searchPage(
          criteria, page, size, request.getSortBy(), request.getSortDir());
      List<FspSearchResult> content = pageResult.rows().stream()
          .map(FspService::toSearchDto)
          .toList();
      return PageableResponse.ofPage(content, page, size, pageResult.total());
    }

    // Legacy proc path (rollback). The proc returns the whole cursor, so
    // sort + paginate in memory. P_ENTRY_USER_CLIENT_NUMBER comes from the
    // FAM role suffix (e.g. FSPTS_ADMINISTRATOR_00012797 → "00012797").
    List<Fsp100SearchDao.Row> rows = searchDao.mainline(
        ACTION_GET,
        nz(request.getFspId()),
        nz(request.getFspPlanName()),
        nz(request.getOrgUnitNo()),
        nz(request.getAhClientNumber()),
        nz(request.getFspAmendmentName()),
        userClientNumber,
        RequestUtil.getCurrentIdir(),
        userRoles,
        nz(request.getFspDateStart()),
        nz(request.getFspDateEnd()),
        nz(request.getFspDateType()),
        nz(request.getFspStatusCode()),
        nz(request.getApprovalRequired()),
        0
    ).rows();

    List<FspSearchResult> all = rows.stream()
        .map(FspService::toSearchDto)
        .sorted(buildComparator(request.getSortBy(), request.getSortDir()))
        .toList();
    return PageableResponse.of(all, page, size);
  }

  private static Comparator<FspSearchResult> buildComparator(String sortBy, String sortDir) {
    String resolved = SORT_KEYS.containsKey(sortBy) ? sortBy : "fspId";
    Function<FspSearchResult, String> extract = SORT_KEYS.get(resolved);
    // nullsLast so rows with a missing value land at the bottom in both
    // directions. NUMERIC_SORT_KEYS routes through Long compare so the
    // fspId / amendmentNumber columns sort numerically; everything else
    // uses caseInsensitiveOrder so mixed-case free-text (planName,
    // agreementHolder) sorts intuitively.
    Comparator<FspSearchResult> asc = NUMERIC_SORT_KEYS.contains(resolved)
        ? Comparator.comparing(extract.andThen(FspService::toLong),
            Comparator.nullsLast(Long::compareTo))
        : Comparator.comparing(extract,
            Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER));
    return "asc".equalsIgnoreCase(sortDir) ? asc : asc.reversed();
  }

  /**
   * Build the SAVE-path P_FSP_LICENSES VARRAY input from the DTO's
   * agreementHolders list. Empty list is returned (not null) — the
   * proc's IS NULL guards short-circuit to no_access_right.
   */
  private static List<LicenseeArrayElement> toLicenseeVarray(FspRequest request) {
    if (request == null || request.getAgreementHolders() == null) {
      return List.of();
    }
    return request.getAgreementHolders().stream()
        .map(h -> new LicenseeArrayElement(
            h.getClientNumber(), h.getClientName(), h.getAgreementDescription()))
        .toList();
  }

  /** Build the SAVE-path P_ORG_UNITS VARRAY input from the DTO's districts list. */
  private static List<OrgUnitArrayElement> toOrgUnitVarray(FspRequest request) {
    if (request == null || request.getDistricts() == null) {
      return List.of();
    }
    return request.getDistricts().stream()
        .map(d -> new OrgUnitArrayElement(d.getOrgUnitNo(), d.getOrgUnitCode(), d.getOrgUnitName()))
        .toList();
  }

  /** Lenient String → Long; non-numeric or blank → null (sort tail). */
  private static Long toLong(String s) {
    if (s == null) return null;
    String trimmed = s.trim();
    if (trimmed.isEmpty()) return null;
    try {
      return Long.valueOf(trimmed);
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  // Legacy-role mapping / client-number extraction moved to
  // RequestUtil.getCurrentLegacyRoles + RequestUtil.getCurrentClientNumber
  // so other services (e.g. ExtensionService) can reuse the same
  // FAM-cognito → legacy-proc translation.

  public FspRequest getById(String fspId) {
    return getById(fspId, null);
  }

  /**
   * Reads the FSP information record via FSP_300_INFORMATION.MAINLINE
   * with P_ACTION=GET. {@code amendmentNumber} is optional — the proc
   * returns the latest amendment when blank, otherwise the matching one.
   */
  public FspRequest getById(String fspId, String amendmentNumber) {
    Fsp300InformationDao.Result r = callInformation(ACTION_GET, fspId, amendmentNumber, null);
    FspRequest dto = toFspDto(r);
    enrichAgreementHoldersWithFoms(fspId, dto);
    return dto;
  }

  /**
   * Fills each agreement holder's {@code associatedFoms} from the nr-fom API,
   * matching FOMs to holders by forest-client / client number. Best-effort:
   * the FOM client swallows upstream errors and returns an empty map, so a
   * FOM outage leaves the column blank rather than failing the FSP load
   * (mirrors legacy {@code Fsp300InformationAction.populateFomByFSP}).
   */
  private void enrichAgreementHoldersWithFoms(String fspId, FspRequest dto) {
    if (dto == null || dto.getAgreementHolders() == null || dto.getAgreementHolders().isEmpty()) {
      return;
    }
    Map<String, String> fomsByClient = fomClient.fomIdsByForestClient(fspId);
    if (fomsByClient.isEmpty()) {
      return;
    }
    for (FspRequest.AgreementHolder holder : dto.getAgreementHolders()) {
      holder.setAssociatedFoms(fomsByClient.get(holder.getClientNumber()));
    }
  }

  @Transactional
  public FspRequest update(String fspId, FspRequest request) {
    // FSP_300_INFORMATION.MAINLINE with P_ACTION=SAVE expects the FULL
    // record on the wire (amendment_number, revision_count, status code,
    // agreement holders, org units, amendment code, plus every plan
    // field). When the client posts only a sparse "what changed" subset
    // the proc trips ORA-01403 inside its internal lookups — the legacy
    // app worked because its form bean cached the full GET result and
    // round-tripped every field on save. Replicate that here: read the
    // current row, overlay the editable fields from the request, then
    // call SAVE with the merged DTO.
    String amendmentNumber = request == null ? null : request.getFspAmendmentNumber();
    // Ownership + status fence: Administrators can't edit APP/INE/SUB plans,
    // Submitters can only edit Drafts. (Amend/Extend/Replace are separate and
    // not gated here.)
    accessGuard.assertContentEditable(fspId, amendmentNumber);
    FspRequest merged = getById(fspId, amendmentNumber);
    applyEdits(merged, request);
    Fsp300InformationDao.Result r = callInformation(ACTION_SAVE, fspId, null, merged);
    // Enrich the SAVE response the same way GET does — the UI renders the
    // returned DTO directly (no refetch), so without this a newly added
    // agreement holder shows a blank Associated FOMs cell until the page
    // is reloaded.
    FspRequest dto = toFspDto(r);
    enrichAgreementHoldersWithFoms(fspId, dto);
    return dto;
  }

  /**
   * Overlay caller-supplied changes onto a freshly-read FSP record.
   * Null fields in {@code edits} are treated as "no change" — only
   * non-null values replace the corresponding field on {@code target}.
   * Limited to the subset of fields the UI exposes for editing on the
   * Information tab; status / IDs / amendment metadata / VARRAYs stay
   * with whatever came back from GET.
   */
  private static void applyEdits(FspRequest target, FspRequest edits) {
    if (edits == null) return;
    if (edits.getFspPlanName() != null) target.setFspPlanName(edits.getFspPlanName());
    if (edits.getFspContactName() != null) target.setFspContactName(edits.getFspContactName());
    if (edits.getFspTelephoneNumber() != null) target.setFspTelephoneNumber(edits.getFspTelephoneNumber());
    if (edits.getFspEmailAddress() != null) target.setFspEmailAddress(edits.getFspEmailAddress());
    if (edits.getFspPlanStartDate() != null) target.setFspPlanStartDate(edits.getFspPlanStartDate());
    if (edits.getFspPlanEndDate() != null) target.setFspPlanEndDate(edits.getFspPlanEndDate());
    if (edits.getFspExpiryDate() != null) target.setFspExpiryDate(edits.getFspExpiryDate());
    if (edits.getFspPlanTermYears() != null) target.setFspPlanTermYears(edits.getFspPlanTermYears());
    if (edits.getFspPlanTermMonths() != null) target.setFspPlanTermMonths(edits.getFspPlanTermMonths());
    if (edits.getAmendmentName() != null) target.setAmendmentName(edits.getAmendmentName());
    if (edits.getAmendmentAuthority() != null) target.setAmendmentAuthority(edits.getAmendmentAuthority());
    if (edits.getAmendmentReason() != null) target.setAmendmentReason(edits.getAmendmentReason());
    if (edits.getTransitionInd() != null) target.setTransitionInd(edits.getTransitionInd());
    if (edits.getFrpa197electionInd() != null) target.setFrpa197electionInd(edits.getFrpa197electionInd());
    // FSP301 (Amendment / Replacement Description dialog) edits these
    // four Y/N indicators along with the summary text. They share the
    // FSP_300_INFORMATION SAVE proc as the regular Information tab.
    if (edits.getFduUpdateInd() != null) target.setFduUpdateInd(edits.getFduUpdateInd());
    if (edits.getIdentifiedAreasUpdateInd() != null) {
      target.setIdentifiedAreasUpdateInd(edits.getIdentifiedAreasUpdateInd());
    }
    if (edits.getStockingStandardUpdateInd() != null) {
      target.setStockingStandardUpdateInd(edits.getStockingStandardUpdateInd());
    }
    if (edits.getApprovalRequiredInd() != null) {
      target.setApprovalRequiredInd(edits.getApprovalRequiredInd());
    }
    // VARRAY-style collections — when caller supplies a list, replace
    // the GET-resolved one. Drives the Add Agreement Holder / Add
    // District dialogs: frontend sends the full list (existing + new)
    // and the proc rewrites the licensees / org-units relations.
    if (edits.getAgreementHolders() != null) {
      target.setAgreementHolders(edits.getAgreementHolders());
    }
    if (edits.getDistricts() != null) {
      target.setDistricts(edits.getDistricts());
    }
  }

  /**
   * Create a brand-new FSP — corresponds to the legacy "actionCode=I"
   * (Initial) submission. Calls the same FSP_300_INFORMATION.MAINLINE
   * SAVE proc with {@code p_fsp_id} blank so the proc routes to
   * fsp_common_db.fsp_create_new and assigns an id from FSP_SEQ. The
   * assigned id comes back via INOUT and is surfaced on the returned
   * DTO.
   *
   * <p>The proc validates that the request carries at least one
   * agreement holder (otherwise {@code FSP.NO.AGREEMENT.HOLDER}); the
   * caller must populate {@code request.agreementHolders} before
   * invoking this.
   */
  @Transactional
  public FspRequest create(FspRequest request) {
    Fsp300InformationDao.Result r = callInformation(ACTION_SAVE, null, null, request);
    FspRequest saved = toFspDto(r);
    // fsp_common_db.fsp_create_new inserts plan_start_date = NULL on
    // the original amendment, but the GET path's get_original_start_date()
    // helper trips ORA-01403 when that column is null — meaning a
    // freshly-created FSP couldn't be opened in the UI. Backfill it
    // here so the create path leaves a readable row. No-op if already set.
    if (saved.getFspId() != null && !saved.getFspId().isBlank()) {
      try {
        long fspIdLong = Long.parseLong(saved.getFspId());
        long amendmentLong = parseLongOrZero(saved.getFspAmendmentNumber());
        int updated = informationDao.setPlanStartDateIfNull(fspIdLong, amendmentLong);
        if (updated > 0) {
          log.info("Backfilled plan_start_date on new fsp_id={} amendment={}",
              fspIdLong, amendmentLong);
        }
      } catch (NumberFormatException e) {
        log.warn("Skipped plan_start_date backfill — non-numeric fspId/amendment returned by SAVE: {} / {}",
            saved.getFspId(), saved.getFspAmendmentNumber());
      }
    }
    return saved;
  }

  private static long parseLongOrZero(String s) {
    if (s == null || s.isBlank()) {
      return 0L;
    }
    try {
      return Long.parseLong(s);
    } catch (NumberFormatException e) {
      return 0L;
    }
  }

  /**
   * Create a new amendment row on an existing FSP. Corresponds to the
   * legacy {@code actionCode="A"} (Amendment) submission. The proc
   * routes through {@code fsp_common_db.fsp_create_amendment} which
   * auto-assigns the next amendment_number, seeds the row with
   * {@code FSP_STAT_DFT} status, and copies licensee/org-unit data
   * forward from the prior amendment.
   *
   * <p>The returned DTO carries the proc-assigned
   * {@code fspAmendmentNumber} — callers must use it for the
   * follow-up {@code update()} call that populates the body fields.
   *
   * <p>The submitted {@code request.fspAmendmentNumber} is ignored
   * here — the proc owns the assignment.
   */
  /**
   * Hard-delete an FSP (master row + child records) via
   * {@code FSP_300_INFORMATION.MAINLINE} with {@code P_ACTION=REMOVE}.
   * The proc raises {@code FSP.CANNOT.DEL.PREV.AMENDMENT} for FSPs
   * that aren't in DFT or REJ status, and {@code fsp_tombstone.user_may_access}
   * still gates by role + client number so a BCeID submitter can't
   * delete an FSP they're not an agreement holder on.
   *
   * <p>The amendment number narrows the delete to a specific row;
   * pass the head amendment to delete the whole plan (the proc walks
   * the children of that single amendment row).
   */
  @Transactional
  public void delete(String fspId, String amendmentNumber) {
    accessGuard.assertWritable(fspId, nz(amendmentNumber));
    callInformation(ACTION_REMOVE, fspId, nz(amendmentNumber), null);
  }

  /**
   * Flip a Draft FSP/amendment to Submitted via
   * {@code FSP_300_INFORMATION.MAINLINE} with {@code P_ACTION=SUBMIT}.
   * The proc validates the FSP via {@code fsp_common_validation.validate_fsp}
   * before transitioning — any missing required field, invalid
   * agreement holder, etc. surfaces as a {@code FSP.*} error and the
   * status stays in DFT.
   *
   * <p>When the amendment's {@code amendment_approval_requird_ind} is
   * {@code 'N'} the proc cascades to {@code fsp_approval} which moves
   * the amendment straight to IN-EFFECT and retires prior approved
   * amendments. With {@code 'Y'} (the normal case) the new status is
   * SUB, awaiting ministry decision.
   *
   * @param amendmentNumber the amendment to submit. When blank the
   *     proc resolves the current amendment via the tombstone read.
   */
  @Transactional
  public FspRequest submit(String fspId, String amendmentNumber) {
    // MAINLINE's SUBMIT dispatch internally calls SAVE before the
    // status transition (R__06394_FSP_300_INFORMATION.sql:1300-1332),
    // and SAVE in turn calls fsp_update with whatever this client
    // passes for plan_name, contact details, licensees, org units, etc.
    // The legacy Fsp300InformationAction.handleSubmit sent the FSP's
    // fully-populated form bean — we have to do the same or the proc
    // sees blanks and emits FSP.NO.NAME / NO.CONTACT.PERSON / NO.
    // AGREEMENT.HOLDER. GET the current row first so the SAVE in
    // SUBMIT runs as a no-op rewrite of the existing state.
    FspRequest current = getById(fspId, nz(amendmentNumber));
    callInformation(ACTION_SUBMIT, fspId, nz(amendmentNumber), current);
    // The inner submit() call updates the row's fsp_status_code, but
    // MAINLINE's IN/OUT parameters don't get refreshed from the row
    // after the transition — the returned DTO would still show the
    // pre-submit status. Re-read so the SPA sees the new status
    // (typically SUB, or INE when approval_required_ind='N').
    return getById(fspId, nz(amendmentNumber));
  }

  /**
   * Submit preflight — runs the same {@code validate_fsp} chain the
   * SUBMIT proc would run, but without changing status. Returns every
   * accumulated proc error mapped to a curated user message so the
   * SPA can render a "fix this before you submit" checklist.
   *
   * <p>{@code amendmentNumber} may be blank — the proc validates
   * whichever amendment the tombstone read resolves, same as the
   * SUBMIT path.
   */
  @Transactional(readOnly = true)
  public ca.bc.gov.nrs.fsp.api.struct.v1.SubmitPreflightResponse preflightSubmit(
      String fspId, String amendmentNumber) {
    long fspIdLong = Long.parseLong(fspId);
    long amendmentLong = parseLongOrZero(amendmentNumber);
    List<ca.bc.gov.nrs.fsp.api.dao.v1.FspValidationDao.ValidationError> raw =
        validationDao.validate(fspIdLong, amendmentLong);
    List<ca.bc.gov.nrs.fsp.api.struct.v1.SubmitPreflightResponse.Issue> issues = raw.stream()
        .map(e -> {
          String curated = ca.bc.gov.nrs.fsp.api.exception.ProcErrorMessages.messageFor(e.code());
          // Prefer curated message; fall back to whatever the proc
          // formatted (FSP.COMMON.* codes include their template
          // parameters in the proc message).
          String surface = curated != null ? curated
              : (e.procMessage() != null && !e.procMessage().isBlank()
                  ? e.procMessage() : e.code());
          return new ca.bc.gov.nrs.fsp.api.struct.v1.SubmitPreflightResponse.Issue(
              e.code(), e.procMessage(), surface);
        })
        .toList();
    return new ca.bc.gov.nrs.fsp.api.struct.v1.SubmitPreflightResponse(issues.isEmpty(), issues);
  }

  @Transactional
  public FspRequest amend(String fspId, FspRequest request) {
    accessGuard.assertWritable(fspId, null);
    Fsp300InformationDao.Result r = callInformation(ACTION_AMEND, fspId, "", request);
    return toFspDto(r);
  }

  /**
   * Create a new Replacement amendment row on an existing FSP —
   * corresponds to the legacy {@code actionCode="R"} submission
   * (FSP304 ReplaceInformation) and the legacy proc invocation
   * {@code P_ACTION="REPLACE"} with {@code p_fsp_amendment_code="RPL"}.
   * The proc auto-assigns the next amendment_number; the returned DTO
   * carries it so the caller can issue the follow-up SAVE that
   * populates body fields.
   *
   * <p>Like {@link #amend(String, FspRequest)} this only seeds the
   * skeleton — the body still needs a SAVE pass on the proc-assigned
   * amendment number.
   */
  @Transactional
  public FspRequest replace(String fspId, FspRequest request) {
    // Force fsp_amendment_code='RPL' so callers can't accidentally
    // route a Replacement through the AMD lookup. Mirrors the legacy
    // Fsp304ReplaceInformationAction.handleSave hard-set.
    request.setFspAmendmentCode("RPL");
    accessGuard.assertWritable(fspId, null);
    Fsp300InformationDao.Result r = callInformation(ACTION_REPLACE, fspId, "", request);
    return toFspDto(r);
  }

  private Fsp300InformationDao.Result callInformation(
      String action, String fspId, String amendmentNumber, FspRequest request) {
    // FSP_300_INFORMATION.MAINLINE branches on the audit user context
    // when scoping editable fields; the read path needs userId + the
    // mapped legacy role string just as much as update does. When the
    // caller didn't supply them in the request body, fall back to the
    // current JWT.
    //
    // Pass the directory-prefixed form (IDIR\name / BCEID\name) so the
    // audit columns on FSP master rows match what the legacy SilUser
    // path stamped (formBean.getUser().getName() returned the full
    // "IDIR\MAVILLEN" form). The FSP_300_INFORMATION proc uses
    // p_update_userid only for audit-column assignment — no joins on
    // the value — so the prefixed string is safe here. The actual
    // authorization check goes through fsp_tombstone.user_may_access
    // which gates on role + client number, not username. Do NOT pass
    // the 46-char Cognito subject ("idir_<guid>@idir") — the audit
    // columns are VARCHAR2(30); the truncate inside the helper keeps
    // the prefixed form under that cap.
    String userId = RequestUtil.getCurrentAuditUserId();
    String userRoles = request != null && request.getUserRole() != null
        ? request.getUserRole()
        : RequestUtil.getCurrentLegacyRoles();
    // Admin bypass for the FSP.INVALID.AGREEMENT.HOLDER check.
    // FSP_300_INFORMATION's holder-modification guard is:
    //     IF (v_count = 0) AND (p_user_client_number IS NOT NULL)
    //       THEN raise FSP.INVALID.AGREEMENT.HOLDER
    // — a NULL/empty client number is treated as "internal admin
    // acting on behalf of the system" and skips the membership check
    // entirely. So when the current JWT carries FSPTS_ADMINISTRATOR,
    // pass empty to let admins manage holders on FSPs they're not
    // listed on. Explicit request.userClientNumber still wins so
    // tests and the persistence pipeline can override.
    String userClientNumber;
    if (request != null && request.getUserClientNumber() != null) {
      userClientNumber = request.getUserClientNumber();
    } else if (RequestUtil.isCurrentUserAdmin()) {
      userClientNumber = "";
    } else {
      userClientNumber = RequestUtil.getCurrentClientNumber();
    }
    String resolvedAmendmentNumber = amendmentNumber != null
        ? amendmentNumber
        : (request == null ? "" : nz(request.getFspAmendmentNumber()));
    // The legacy Fsp300InformationAction routes the requested FSP id +
    // amendment number through the P_NEW_* positions on GET (the proc
    // reads from P_NEW_FSP_ID / P_NEW_FSP_AMENDMENT_NUMBER and writes
    // the resolved values back into P_FSP_ID / P_FSP_AMENDMENT_NUMBER).
    // P_FSP_ID stays blank on GET; otherwise the proc treats the call
    // as "look up an existing record by primary key" and returns
    // noRecordsFound for unsaved/draft amendments. UPDATE keeps the
    // post-fetch convention with the id in P_FSP_ID.
    boolean isGet = ACTION_GET.equals(action);
    String inFspId = isGet ? "" : fspId;
    String inNewFspId = isGet ? fspId : "";
    // On GET, P_FSP_AMENDMENT_NUMBER stays blank (the proc echoes the
    // resolved value back to it). P_NEW_FSP_AMENDMENT_NUMBER is what
    // the proc reads:
    //   - blank → fsp_tombstone.get's "find latest accessible
    //     amendment" branch (the OR condition's IS NULL trips TRUE)
    //   - non-blank → strict (fsp_id, amendment_number) lookup, which
    //     the user-picked amendment dropdown needs to honour.
    String inAmendment = isGet ? "" : resolvedAmendmentNumber;
    String inNewAmendment = resolvedAmendmentNumber;
    return informationDao.mainline(
        action,
        inFspId,
        inNewFspId,
        request == null ? "" : nz(request.getFspPlanName()),
        // Legacy Fsp300InformationBean initialises the three VARRAY
        // fields as empty (`new FspOrgUnitVArray()`), not null. Oracle
        // PL/SQL treats NULL collections differently from empty ones —
        // some IS NULL checks in the proc trip and short-circuit to
        // no_access_right. Bind empty lists so the wire shape matches
        // legacy byte-for-byte.
        List.of(),  // P_FSP_ORG_UNITS
        request == null ? "" : nz(request.getFspStatusCode()),
        request == null ? "" : nz(request.getFspStatusDesc()),
        inAmendment,
        inNewAmendment,
        userClientNumber,
        userRoles,
        request == null ? "" : nz(request.getSubmissionId()),
        request == null ? "" : nz(request.getFspExpiryDate()),
        request == null ? "" : nz(request.getAmendmentName()),
        request == null ? "" : nz(request.getAmendmentEfftvDate()),
        // P_NEW_FSP_PLAN_NAME + P_NEW_AMENDMENT_NAME are the *input*
        // slots the proc reads on SAVE/AMEND/CHANGE_AMEND. Positions
        // 4 + 14 (P_FSP_PLAN_NAME / P_AMENDMENT_NAME) are the
        // *output* slots the proc writes back on GET. Sending the
        // request values here so the SAVE branch doesn't trip
        // 'FSP.NO.NAME' even when position 4 carries the same value.
        request == null ? "" : nz(request.getFspPlanName()),     // P_NEW_FSP_PLAN_NAME
        request == null ? "" : nz(request.getAmendmentName()),   // P_NEW_AMENDMENT_NAME
        request == null ? "" : nz(request.getFspPlanStartDate()),
        request == null ? "" : nz(request.getFspPlanTermYears()),
        request == null ? "" : nz(request.getFspPlanTermMonths()),
        request == null ? "" : nz(request.getFspPlanEndDate()),
        request == null ? "" : nz(request.getFspPlanSubmissionDate()),
        request == null ? "" : nz(request.getFspContactName()),
        request == null ? "" : nz(request.getFspTelephoneNumber()),
        request == null ? "" : nz(request.getFspEmailAddress()),
        request == null ? "" : nz(request.getFduUpdateInd()),
        request == null ? "" : nz(request.getIdentifiedAreasUpdateInd()),
        request == null ? "" : nz(request.getStockingStandardUpdateInd()),
        request == null ? "" : nz(request.getApprovalRequiredInd()),
        request == null ? "" : nz(request.getTransitionInd()),
        request == null ? "" : nz(request.getFrpa197electionInd()),
        request == null ? "" : nz(request.getAmendmentAuthority()),
        // P_FSP_LICENSES + P_ORG_UNITS are the SAVE-path inputs the
        // proc validates ('FSP.NO.AGREEMENT.HOLDER' fires if licenses
        // is empty). On GET they remain empty and the proc populates
        // them via OUT-mode INOUT semantics. The earlier always-empty
        // bind worked for GET but silently broke SAVE.
        toLicenseeVarray(request),  // P_FSP_LICENSES
        toOrgUnitVarray(request),   // P_ORG_UNITS
        "",   // P_FSP_STATUS
        // P_ENTRY_USERID — legacy Fsp300InformationAction.handleGet
        // does NOT set this; the form bean's default of "" carries
        // through. The proc treats it as "the user who created the row"
        // and (when populated) joins it against the FSP's audit row
        // looking for a match. Sending the current user's IDIR makes
        // that join fail for any FSP not entered by them and the proc
        // returns no_access_right. Only P_UPDATE_USERID is the current
        // actor on the read path.
        "",
        request == null ? "" : nz(request.getAmendmentReason()),
        request == null ? "" : nz(request.getFspRejectedByEsfInd()),
        request == null ? "" : nz(request.getFspUnapprovedAmendsInd()),
        request == null ? "" : nz(request.getFspExtensionStat()),
        request == null ? "" : nz(request.getFspAmendmentCode()),
        request == null ? "" : nz(request.getFspAmendmentDesc()),
        "",   // P_IS_EXPIRY_CHANGED
        request == null ? "" : nz(request.getRevisionCount()),
        userId  // P_UPDATE_USERID
    );
  }

  private static FspSearchResult toSearchDto(Fsp100SearchDao.Row row) {
    return FspSearchResult.builder()
        .fspId(row.fspId())
        .planName(row.planName())
        .fspAmendmentName(row.fspAmendmentName())
        .orgUnitCode(row.orgUnitCode())
        .planStartDate(row.planStartDate())
        .planEndDate(row.planEndDate())
        .fspAmendmentNumber(row.fspAmendmentNumber())
        .agreementHolder(row.agreementHolder())
        .amendmentApprovalRequirdInd(row.amendmentApprovalRequirdInd())
        .fspStatusDesc(row.fspStatusDesc())
        .build();
  }

  private static FspRequest toFspDto(Fsp300InformationDao.Result r) {
    return FspRequest.builder()
        .fspId(r.pFspId())
        .newFspId(r.pNewFspId())
        .fspPlanName(r.pFspPlanName())
        .fspStatusCode(r.pFspStatusCode())
        .fspStatusDesc(r.pFspStatusDesc())
        .fspAmendmentNumber(r.pFspAmendmentNumber())
        .newFspAmendmentNumber(r.pNewFspAmendmentNumber())
        .userClientNumber(r.pUserClientNumber())
        .userRole(r.pUserRole())
        .submissionId(r.pSubmissionId())
        .fspExpiryDate(r.pFspExpiryDate())
        .amendmentName(r.pAmendmentName())
        .amendmentEfftvDate(r.pAmendmentEfftvDate())
        .fspPlanStartDate(r.pFspPlanStartDate())
        .fspPlanTermYears(r.pFspPlanTermYears())
        .fspPlanTermMonths(r.pFspPlanTermMonths())
        .fspPlanEndDate(r.pFspPlanEndDate())
        .fspPlanSubmissionDate(r.pFspPlanSubmissionDate())
        .fspContactName(r.pFspContactName())
        .fspTelephoneNumber(r.pFspTelephoneNumber())
        .fspEmailAddress(r.pFspEmailAddress())
        .fduUpdateInd(r.pFduUpdateInd())
        .identifiedAreasUpdateInd(r.pIdentifiedAreasUpdateInd())
        .stockingStandardUpdateInd(r.pStockingStandardUpdateInd())
        .approvalRequiredInd(r.pApprovalRequiredInd())
        .transitionInd(r.pTransitionInd())
        .frpa197electionInd(r.pFrpa197electionInd())
        .amendmentAuthority(r.pAmendmentAuthority())
        .amendmentReason(r.pAmendmentReason())
        .fspRejectedByEsfInd(r.pFspRejectedByEsfInd())
        .fspUnapprovedAmendsInd(r.pFspUnapprovedAmendsInd())
        .fspExtensionStat(r.pFspExtensionStat())
        .fspAmendmentCode(r.pFspAmendmentCode())
        .fspAmendmentDesc(r.pFspAmendmentDesc())
        .revisionCount(r.pRevisionCount())
        .agreementHolders(r.pFspLicenses() == null ? List.of()
            : r.pFspLicenses().stream()
                .map(l -> new FspRequest.AgreementHolder(
                    l.clientNumber(), l.clientName(), l.agreementDescription(), null))
                .toList())
        .districts(r.pOrgUnits() == null ? List.of()
            : r.pOrgUnits().stream()
                .map(o -> new FspRequest.District(
                    o.orgUnitNo(), o.orgUnitCode(), o.orgUnitName()))
                .toList())
        .build();
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
