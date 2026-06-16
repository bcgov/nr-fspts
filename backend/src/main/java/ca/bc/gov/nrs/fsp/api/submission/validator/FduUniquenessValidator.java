package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Two FDUs in the same submission cannot share a name — the proc
 * raises {@code FSP.DUPLICATE.FDU.NAME} on the second insert.
 * Comparison is case-insensitive, with surrounding whitespace
 * collapsed, to match the proc's NLS_UPPER-based dedup behaviour.
 */
@Component
@Slf4j
public class FduUniquenessValidator {

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) return errors;
    FDUAssociationType fduList = plan.getFduList();
    if (fduList == null || fduList.getFdu() == null) return errors;

    List<FDUType> fdus = fduList.getFdu();
    // key (uppercased, trimmed) → first-seen index
    Map<String, Integer> firstSeen = new HashMap<>();
    for (int i = 0; i < fdus.size(); i++) {
      String name = fdus.get(i).getFduName();
      if (name == null || name.isBlank()) continue;
      String key = name.trim().toUpperCase(Locale.ROOT);
      Integer prior = firstSeen.putIfAbsent(key, i);
      if (prior != null) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/fduList/fdu[" + i + "]/fduName",
            "DUPLICATE_FDU_NAME",
            "FDU name \"" + name.trim() + "\" is also used by FDU #"
                + (prior + 1) + " in the same submission."));
      }
    }
    return errors;
  }
}
