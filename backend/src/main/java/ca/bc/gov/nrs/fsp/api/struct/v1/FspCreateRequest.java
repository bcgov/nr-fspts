package ca.bc.gov.nrs.fsp.api.struct.v1;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Payload for {@code POST /v1/fsp} — the "Create FSP" dialog.
 *
 * <p>Deliberately the <b>minimum</b> set {@code FSP_300_INFORMATION}'s SAVE
 * branch will accept for a brand-new plan. Everything here is required by
 * {@code FSP_COMMON_VALIDATION} except the plan-term triplet, where term
 * (years/months) and end date are mutually exclusive — supply one or the
 * other, never both ({@code FSP.BOTH.PLAN.TERM_OR_END_DATE}).
 *
 * <p>Amendment metadata (name, comment, approval-required) is absent by
 * design: an Initial plan has no amendment to describe, and
 * {@code SubmissionPersistenceService} discards those fields on the I/U path
 * for the same reason.
 *
 * <p>{@code @JsonIgnoreProperties} because the app runs with
 * {@code fail-on-unknown-properties=true} — without it any stray field a
 * client sends becomes an unhelpful 400 about deserialization rather than a
 * validation message.
 */
@Data
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class FspCreateRequest {

  /** Plan name. Required; max 120 characters. */
  private String planName;

  /** Contact person. Required; max 120 characters. */
  private String contactName;

  /** Contact phone. Required; exactly 10 digits, no separators. */
  private String telephoneNumber;

  /** Contact email. Required; max 120 characters. */
  private String emailAddress;

  /**
   * Agreement-holder client numbers. At least one required.
   *
   * <p>A Submitter's own client number must be among them — the proc's
   * {@code FSP.INVALID.AGREEMENT.HOLDER} guard rejects a create whose holder
   * list doesn't include {@code p_user_client_number}. Administrators are
   * exempt (their client number is passed empty, which Oracle reads as NULL,
   * skipping the check).
   */
  private List<String> agreementHolderClientNumbers;

  /**
   * District org unit NUMBERS (e.g. "15"), not the 3-letter codes.
   *
   * <p>{@code FSP_300_INFORMATION.save_org_units} passes only
   * {@code p_org_units(i).org_unit_no} to {@code fsp_org_unit_create} — the
   * code and name attributes of the VARRAY element are ignored — so a payload
   * carrying codes alone would insert districts with a null org unit no. The
   * submission pipeline resolves codes to numbers for the same reason
   * ({@code SubmissionPersistenceService.resolveDistrictOrgUnitNumbers}); the
   * dialog sources numbers directly from
   * {@code FSP_CODE_LISTS.get_org_unit_filtered}, the same list the FSP
   * details "Add district" picker uses.
   *
   * <p>At least one is required.
   */
  private List<String> districtOrgUnitNos;

  /** Plan term, whole years. Mutually exclusive with {@link #planEndDate}. */
  private String planTermYears;

  /** Plan term, additional months. Mutually exclusive with {@link #planEndDate}. */
  private String planTermMonths;

  /** Plan end date (yyyy-MM-dd). Mutually exclusive with the term fields. */
  private String planEndDate;

  /** FRPA s.197 election indicator. Optional; defaults to false. */
  private Boolean frpa197;
}
