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
 * Rules on FDU names within a submission.
 *
 * <p><b>Uniqueness</b> — two FDUs in the same submission cannot share a name;
 * the proc raises {@code FSP.DUPLICATE.FDU.NAME} on the second insert.
 * Comparison is case-insensitive, with surrounding whitespace
 * collapsed, to match the proc's NLS_UPPER-based dedup behaviour.
 *
 * <p><b>Length</b> — names land in
 * {@code FOREST_DEVELOPMENT_UNIT.FDU_NAME VARCHAR2(120)} and nothing between
 * the parser and the proc bounded them, so an over-long name surfaced as a raw
 * {@code ORA-12899} 500 at persist time rather than a validation issue.
 */
@Component
@Slf4j
public class FduNameValidator {

  /** {@code FOREST_DEVELOPMENT_UNIT.FDU_NAME}. */
  private static final int MAX_FDU_NAME_LEN = 120;

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
      if (name.trim().length() > MAX_FDU_NAME_LEN) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/fduList/fdu[" + i + "]/fduName",
            "FDU_NAME_TOO_LONG",
            "FDU name must be " + MAX_FDU_NAME_LEN + " characters or fewer (got "
                + name.trim().length() + ")."));
      }
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
