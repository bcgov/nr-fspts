package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.IdentifiedAreaType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Identified-areas list checks.
 *
 * <ul>
 *   <li>{@code DUPLICATE_IDENTIFIED_AREA_NAME} —
 *       {@code FSP.DUPLICATE.IDENTIFIED.AREA.NAME} on a second insert
 *       sharing the same {@code identifiedAreaName}.</li>
 *   <li>{@code INVALID_LEGISLATION_TYPE} — must be one of
 *       {@code FRPA196(1)}, {@code FRPA196(2)}, {@code FPPR14(4)} —
 *       proc raises {@code FSP.INVALID.LEGISLATION.TYPE} otherwise.</li>
 * </ul>
 */
@Component
@Slf4j
public class IdentifiedAreaValidator {

  // Mirrors the proc's allowed list — the XSD's element docstring on
  // legislationTypeCode names the same three codes.
  private static final Set<String> ALLOWED_LEGISLATION_TYPES = Set.of(
      "FRPA196(1)", "FRPA196(2)", "FPPR14(4)");

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) return errors;
    IdentifiedAreaAssociationType list = plan.getIdentifiedAreasList();
    if (list == null || list.getIdentifiedArea() == null) return errors;

    List<IdentifiedAreaType> areas = list.getIdentifiedArea();
    Map<String, Integer> firstSeen = new HashMap<>();
    for (int i = 0; i < areas.size(); i++) {
      IdentifiedAreaType area = areas.get(i);
      String name = area.getIdentifiedAreaName();
      if (name != null && !name.isBlank()) {
        String key = name.trim().toUpperCase(Locale.ROOT);
        Integer prior = firstSeen.putIfAbsent(key, i);
        if (prior != null) {
          errors.add(SubmissionValidationError.of(
              "forestStewardshipPlan/identifiedAreasList/identifiedArea[" + i
                  + "]/identifiedAreaName",
              "DUPLICATE_IDENTIFIED_AREA_NAME",
              "Identified area name \"" + name.trim()
                  + "\" is also used by identifiedArea #" + (prior + 1)
                  + " in the same submission."));
        }
      }
      String legislation = area.getLegislationTypeCode();
      if (legislation != null && !legislation.isBlank()
          && !ALLOWED_LEGISLATION_TYPES.contains(legislation.trim())) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/identifiedAreasList/identifiedArea[" + i
                + "]/legislationTypeCode",
            "INVALID_LEGISLATION_TYPE",
            "legislationTypeCode \"" + legislation.trim()
                + "\" is not one of FRPA196(1), FRPA196(2), FPPR14(4)."));
      }
    }
    return errors;
  }
}
