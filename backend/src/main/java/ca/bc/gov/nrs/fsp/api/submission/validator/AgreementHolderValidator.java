package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PlanHolderAssociationType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Plan-holder list checks.
 *
 * <ul>
 *   <li>{@code AGREEMENT_HOLDER_REQUIRED} — Initial submissions must
 *       carry at least one {@code <clientCode>}; the proc raises
 *       {@code FSP.NO.AGREEMENT.HOLDER} otherwise.</li>
 *   <li>{@code DUPLICATE_AGREEMENT_HOLDER} — the same client code
 *       appearing twice in {@code planHolderList} trips
 *       {@code FSP.DUPLICATE.AGREEMENT.HOLDER} during the SAVE-path
 *       insert into {@code fsp_agreement_holder}.</li>
 * </ul>
 *
 * <p>AMD/RPL submissions can omit the list (the proc carries holders
 * forward from the prior amendment), so the "required" check only
 * fires for actionCode=I.
 */
@Component
@Slf4j
public class AgreementHolderValidator {

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

    PlanHolderAssociationType holders = plan.getPlanHolderList();
    List<String> clientCodes = holders == null ? null : holders.getClientCode();
    boolean empty = clientCodes == null || clientCodes.isEmpty();

    if (empty && plan.getActionCode() == ActionCodeType.I) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/planHolderList",
          "AGREEMENT_HOLDER_REQUIRED",
          "Initial submissions must include at least one"
              + " clientCode in planHolderList."));
      return errors;
    }
    if (empty) return errors;

    Set<String> seen = new HashSet<>();
    for (int i = 0; i < clientCodes.size(); i++) {
      String raw = clientCodes.get(i);
      if (raw == null || raw.isBlank()) continue;
      String key = raw.trim();
      if (!seen.add(key)) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/planHolderList/clientCode[" + i + "]",
            "DUPLICATE_AGREEMENT_HOLDER",
            "Client code \"" + key + "\" appears more than once in"
                + " planHolderList."));
      }
    }
    return errors;
  }
}
