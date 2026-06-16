package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Validates submission-time preconditions tied to the XML's
 * {@code actionCode}:
 *
 * <ul>
 *   <li>{@code A} (Amendment) and {@code R} (Replacement) must reference
 *       an existing {@code <fspID>}.</li>
 *   <li>That FSP must already have an amendment in
 *       {@code APP} (Approved) or {@code INE} (In Effect) status —
 *       {@code fsp_common_db.fsp_create_amendment} templates the new
 *       row off {@code get_max_approved_amendment(fsp_id)}. If that
 *       function returns {@code NULL} the proc silently inserts 0 rows
 *       and later raises {@code ORA-01403} inside
 *       {@code fsp_status_update}. We catch it here so the submitter
 *       sees the problem on upload, not after committing to submit.</li>
 * </ul>
 *
 * <p>Original ({@code I}) and Update-draft ({@code U}) submissions are
 * skipped — neither goes through {@code fsp_create_amendment}.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ActionCodeContextValidator {

  private final FduWriteDao fduWriteDao;

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) {
      return errors;
    }
    ActionCodeType code = plan.getActionCode();
    if (code != ActionCodeType.A && code != ActionCodeType.R) {
      return errors;
    }

    Long fspId = plan.getFspID();
    if (fspId == null) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/fspID",
          "FSP_ID_REQUIRED",
          code == ActionCodeType.A
              ? "Amendment submissions must reference an existing fspID."
              : "Replacement submissions must reference an existing fspID."));
      return errors;
    }

    Long approved = fduWriteDao.findMaxApprovedAmendmentNumber(fspId);
    if (approved == null) {
      String verb = code == ActionCodeType.A ? "amended" : "replaced";
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/fspID",
          "FSP_NO_APPROVED_AMENDMENT",
          "FSP " + fspId + " cannot be " + verb
              + " — it has no Approved or In-Effect amendment to build on."));
    }
    return errors;
  }
}
