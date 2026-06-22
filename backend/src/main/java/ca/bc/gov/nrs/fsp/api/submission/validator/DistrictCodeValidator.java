package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.dao.v1.OrgUnitLookupDao;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.DistrictCodeAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * District / org-unit checks.
 *
 * <ul>
 *   <li>{@code DISTRICT_REQUIRED} — Initial submissions need at least
 *       one {@code <districtCode>}; the proc raises
 *       {@code FSP.NO.ORG.UNIT} otherwise.</li>
 *   <li>{@code UNKNOWN_DISTRICT} — each {@code <districtCode>} must
 *       resolve to a row in {@code ORG_UNIT} (proc:
 *       {@code FSP.BAD.ORG.UNIT}). Hit the existing
 *       {@link OrgUnitLookupDao} cache so this is cheap on repeat.</li>
 *   <li>{@code DUPLICATE_DISTRICT} — same code twice in the list.</li>
 * </ul>
 *
 * <p>AMD/RPL submissions may omit the list and the proc carries it
 * forward from the prior amendment.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DistrictCodeValidator {

  private final OrgUnitLookupDao orgUnitLookupDao;

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
    DistrictCodeAssociationType districts = plan.getDistrictCodeList();
    List<String> codes = districts == null ? null : districts.getDistrictCode();
    boolean empty = codes == null || codes.isEmpty();

    if (empty && plan.getActionCode() == ActionCodeType.I) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/districtCodeList",
          "DISTRICT_REQUIRED",
          "Initial submissions must include at least one districtCode."));
      return errors;
    }
    if (empty) return errors;

    Set<String> seen = new HashSet<>();
    for (int i = 0; i < codes.size(); i++) {
      String raw = codes.get(i);
      if (raw == null || raw.isBlank()) continue;
      String key = raw.trim().toUpperCase();
      if (!seen.add(key)) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/districtCodeList/districtCode[" + i + "]",
            "DUPLICATE_DISTRICT",
            "District code \"" + key + "\" appears more than once."));
        continue;
      }
      if (orgUnitLookupDao.findOrgUnitNoByCode(key).isEmpty()) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/districtCodeList/districtCode[" + i + "]",
            "UNKNOWN_DISTRICT",
            "District code \"" + key + "\" is not a valid district -"
                + " verify the district code."));
      }
    }
    return errors;
  }
}
