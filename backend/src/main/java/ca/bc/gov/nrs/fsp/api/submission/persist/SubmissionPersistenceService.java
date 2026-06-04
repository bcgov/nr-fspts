package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.OrgUnitLookupDao;
import ca.bc.gov.nrs.fsp.api.service.v1.FspService;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Phase 2 entry point for writing a validated FSP submission to the
 * database. Increment 1 covers FSP_300_INFORMATION header fields via
 * the existing {@link FspService#update(String, FspRequest)} path.
 *
 * <p>Increment 2 adds FDU header + geometry + licence writes via
 * {@link FduPersistenceService}. Bypasses PL/SQL (none exists for FDU
 * writes) and issues raw INSERTs through {@code FduWriteDao}.
 *
 * <p>Increment 3 adds identified-area header + geometry writes via
 * {@link IdentifiedAreaPersistenceService}, same raw-INSERT pattern.
 *
 * <p>Increment 4 adds stocking-standards regime + BGC + layer +
 * species writes via {@link StandardsPersistenceService}, calling the
 * existing FSP_550_STDS_PROPOSAL.SAVE / SAVE_BGC_ITEM procs and the
 * FSP_550_SUB_LAYERS / SUB_SPECIES MAINLINE(SAVE) actions.
 *
 * <p>Increment 5 adds file-attachment intake via
 * {@link SubmissionAttachmentService}, defaulting each upload to the
 * "OTHR" (Supporting Documents) category.
 *
 * <p>Not yet implemented (TODO in subsequent increments):
 * <ul>
 *   <li><b>Stocking standards</b> — needs write methods added to
 *       Fsp550StdsProposalDao (legacy package has ADD/SAVE/COPY/REMOVE
 *       but they are not wrapped yet) plus orchestration of the
 *       existing Fsp550SubLayers/SubSpecies mainline(ADD/SAVE) paths.</li>
 *   <li><b>Attachments</b> — Fsp400 has full CRUD already; needs an
 *       adapter that walks fspSubmissionMetadata.attachmentCount and
 *       associates separately-uploaded files.</li>
 * </ul>
 *
 * <p>All increments must run under a single transaction so a failure
 * mid-pipeline rolls the FSP_300 write back; this service is the
 * boundary for that.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SubmissionPersistenceService {

  private final SubmissionToFspRequestMapper mapper;
  private final FspService fspService;
  private final FduPersistenceService fduPersistenceService;
  private final IdentifiedAreaPersistenceService identifiedAreaPersistenceService;
  private final StandardsPersistenceService standardsPersistenceService;
  private final SubmissionAttachmentService attachmentService;
  private final OrgUnitLookupDao orgUnitLookupDao;

  /**
   * Persist the validated submission. Caller must already have run the
   * full {@code SubmissionValidationService.validate()} chain.
   *
   * <p>{@code attachments} may be empty/null when the submission has
   * no separately-uploaded files in this request — the XML's
   * {@code attachmentCount} is treated as informational and any
   * mismatch is logged, not enforced.
   */
  // Constants are the DB-side fsp_amendment_code values that
  // SubmissionToFspRequestMapper#mapActionCode produces from the
  // XML's actionCode (I/U → ORG, A → AMD). The XML's letter codes
  // are an internal vocabulary; the proc layer speaks ORG/AMD.
  /** Original FSP — XML actionCode=I or U → create a new FSP row. */
  private static final String ACTION_ORIGINAL = "ORG";
  /** Amendment — XML actionCode=A → AMEND a new row, then SAVE to populate. */
  private static final String ACTION_AMENDMENT = "AMD";

  @Transactional
  public FspRequest persist(FSPSubmissionType submission, List<MultipartFile> attachments)
      throws IOException {
    FspRequest request = mapper.toFspRequest(submission);
    resolveDistrictOrgUnitNumbers(request);
    String actionCode = request.getFspAmendmentCode();
    log.info(
        "Persisting FSP submission id={} amendment={} actionCode={}",
        request.getFspId(), request.getFspAmendmentNumber(), actionCode);

    // Header write routes by actionCode:
    //   I → fspService.create() (proc assigns fsp_id from FSP_SEQ)
    //   A → fspService.amend() to create the new amendment row, then
    //       fspService.update() on the proc-assigned amendment_number
    //       to populate the body (AMEND only seeds the skeleton).
    //   U → fspService.update() on the existing fsp_id + amendment.
    FspRequest saved;
    if (ACTION_ORIGINAL.equals(actionCode)) {
      saved = fspService.create(request);
      if (saved.getFspId() == null || saved.getFspId().isBlank()) {
        throw new IllegalStateException(
            "FSP creation succeeded but proc did not return an assigned fsp_id");
      }
    } else if (ACTION_AMENDMENT.equals(actionCode)) {
      if (request.getFspId() == null || request.getFspId().isBlank()) {
        throw new IllegalArgumentException(
            "submission with actionCode=A requires an fspID");
      }
      // AMEND creates the new amendment row and returns the
      // proc-assigned amendment_number. The XML's amendmentID is
      // metadata only — the DB owns the actual sequencing.
      FspRequest amended = fspService.amend(request.getFspId(), request);
      String assignedAmendment = amended.getFspAmendmentNumber();
      if (assignedAmendment == null || assignedAmendment.isBlank()) {
        throw new IllegalStateException(
            "AMEND succeeded but proc did not return an assigned amendment_number");
      }
      log.info("AMEND assigned fsp_id={} amendment_number={}",
          request.getFspId(), assignedAmendment);
      request.setFspAmendmentNumber(assignedAmendment);
      saved = fspService.update(request.getFspId(), request);
    } else {
      // U (Update) — existing FSP, existing amendment
      if (request.getFspId() == null || request.getFspId().isBlank()) {
        throw new IllegalArgumentException(
            "submission with actionCode=" + actionCode + " requires an fspID");
      }
      saved = fspService.update(request.getFspId(), request);
    }

    // Use the (possibly newly-assigned) id for the spatial + standards
    // + attachment writes so they're keyed to the right row.
    long fspIdLong = Long.parseLong(saved.getFspId());
    long amendmentNumberLong = parseLongOrZero(saved.getFspAmendmentNumber());
    ForestStewardshipPlanType plan = submission.getSubmissionItem().getForestStewardshipPlan();
    String userId = RequestUtil.getCurrentIdir();
    fduPersistenceService.persist(plan, fspIdLong, amendmentNumberLong, userId);
    identifiedAreaPersistenceService.persist(plan, fspIdLong, amendmentNumberLong, userId);
    standardsPersistenceService.persist(plan, fspIdLong, amendmentNumberLong, userId);

    int expectedAttachmentCount = submission.getFspSubmissionMetadata() == null
        ? 0
        : submission.getFspSubmissionMetadata().getAttachmentCount();
    attachmentService.persist(
        attachments, fspIdLong, amendmentNumberLong, expectedAttachmentCount, userId);

    return saved;
  }

  private static long parseLongOrZero(String s) {
    if (s == null || s.isBlank()) {
      return 0L;
    }
    return Long.parseLong(s);
  }

  /**
   * FSP submission XMLs carry districts as {@code <districtCode>DMK</districtCode>}
   * — the 3-letter operational code. But FSP_300_INFORMATION SAVE's
   * org-unit VARRAY is validated by {@code org_unit_no} (numeric);
   * sending a code in that slot trips
   * {@code FSP.BAD.ORG.UNIT}. Resolve each district's number from
   * its code before the proc call, and fail fast if any code is
   * unknown to the DB.
   */
  private void resolveDistrictOrgUnitNumbers(FspRequest request) {
    if (request.getDistricts() == null || request.getDistricts().isEmpty()) {
      return;
    }
    for (var district : request.getDistricts()) {
      if (district.getOrgUnitNo() != null && !district.getOrgUnitNo().isBlank()) {
        continue; // already resolved
      }
      String code = district.getOrgUnitCode();
      if (code == null || code.isBlank()) {
        continue;
      }
      String orgUnitNo = orgUnitLookupDao.findOrgUnitNoByCode(code).orElseThrow(() ->
          new IllegalArgumentException(
              "submission references unknown district code '" + code
                  + "'; no row in ORG_UNIT with org_unit_code = '" + code + "'"));
      district.setOrgUnitNo(orgUnitNo);
    }
  }
}
