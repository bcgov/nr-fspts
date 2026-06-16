package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Code → number resolution for {@code ORG_UNIT}. Required because
 * FSP_300_INFORMATION's SAVE/AMEND/CHANGE_AMEND paths validate
 * districts by {@code org_unit_no} (numeric), but the FSP XML
 * submission carries only the 3-letter {@code org_unit_code} (e.g.
 * "DMK"). Sending the code in the orgUnitNo slot trips
 * {@code FSP.BAD.ORG.UNIT} in fsp_common_validation.validate_org_unit.
 */
public interface OrgUnitLookupDao {

  /**
   * @return the numeric {@code org_unit_no} for the given
   *     {@code org_unit_code}, or empty when no such code exists.
   */
  Optional<String> findOrgUnitNoByCode(String orgUnitCode);

  /**
   * Full list of org-unit code/name pairs for display lookups (the FSP
   * search result returns the 3-letter {@code org_unit_code} and the
   * SPA wants to render the human-friendly {@code org_unit_name} —
   * this powers that mapping). Sorted by code so paginated rendering
   * is stable.
   */
  List<Map<String, String>> findAllCodeNamePairs();
}
