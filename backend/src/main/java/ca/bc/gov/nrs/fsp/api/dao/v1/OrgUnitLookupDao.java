package ca.bc.gov.nrs.fsp.api.dao.v1;

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
}
