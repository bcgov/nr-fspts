package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PlanHolderAssociationType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
 *   <li>{@code AGREEMENT_HOLDER_NOT_FOUND} — every {@code <clientCode>}
 *       is checked against {@code FOREST_CLIENT}; an unknown id would
 *       otherwise trip the {@code FAH_FC_FK} FK on
 *       {@code FSP_AGREEMENT_HOLDER} mid-pipeline (ORA-02291), by
 *       which point the FSP_300 header has already been written.
 *       Catching it here lets the SPA show the issue in its
 *       validation pane at upload time.</li>
 * </ul>
 *
 * <p>AMD/RPL submissions can omit the list (the proc carries holders
 * forward from the prior amendment), so the "required" check only
 * fires for actionCode=I.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AgreementHolderValidator {

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
    // Per-submission existence cache so the same client appearing on
    // multiple plans / multiple validate runs only hits FOREST_CLIENT
    // once. The HashSet above already deduplicates for the duplicate
    // check, but we still want the existence lookup cached even for
    // duplicates so the second occurrence renders the same error
    // shape rather than re-querying.
    Map<String, Boolean> existsCache = new HashMap<>();
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
        // The duplicate occurrence shares the existence check with the
        // first — skip the second FOREST_CLIENT round-trip via cache.
        continue;
      }
      boolean exists = existsCache.computeIfAbsent(key, fduWriteDao::clientExists);
      if (!exists) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/planHolderList/clientCode[" + i + "]",
            "AGREEMENT_HOLDER_NOT_FOUND",
            "Client code \"" + key + "\" is not a valid agreement"
                + " holder - verify the agreement holder's client"
                + " number."));
      }
    }
    return errors;
  }
}
