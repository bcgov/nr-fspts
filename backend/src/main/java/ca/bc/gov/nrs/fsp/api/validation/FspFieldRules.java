package ca.bc.gov.nrs.fsp.api.validation;

/**
 * Column-derived limits for the FSP header fields, in one place.
 *
 * <p>These map onto {@code THE.FOREST_STEWARDSHIP_PLAN} columns. Exceeding one
 * raises {@code ORA-12899} deep inside {@code FSP_300_INFORMATION}, which
 * surfaces as an opaque 500 naming no field — so every write path that accepts
 * these values from a user is expected to check them first and report a clean
 * validation error instead.
 *
 * <p>Kept here rather than duplicated per-validator because the XML/GeoJSON
 * submission path and the interactive "Create FSP" dialog write the same
 * columns through the same proc; a limit that drifts between them is a bug
 * that only shows up in production.
 *
 * <p>Source: {@code nr-mof-db} {@code V2.01226__FOREST_STEWARDSHIP_PLAN.sql} and
 * {@code V2.01204__FOREST_DEVELOPMENT_UNIT.sql}.
 */
public final class FspFieldRules {

  private FspFieldRules() {
  }

  /** {@code PLAN_NAME VARCHAR2(120)}. */
  public static final int MAX_PLAN_NAME_LEN = 120;
  /** {@code CONTACT_NAME VARCHAR2(120)}. */
  public static final int MAX_CONTACT_NAME_LEN = 120;
  /** {@code EMAIL_ADDRESS VARCHAR2(120)}. */
  public static final int MAX_EMAIL_LEN = 120;
  /** {@code LICENSEE_AMENDMENT_NAME VARCHAR2(30)} — the tightest of the set. */
  public static final int MAX_AMENDMENT_NAME_LEN = 30;
  /** {@code FSP_AGREEMENT_HOLDER.CLIENT_NUMBER VARCHAR2(8)}. */
  public static final int MAX_CLIENT_NUMBER_LEN = 8;
  /** {@code FOREST_DEVELOPMENT_UNIT.FDU_NAME VARCHAR2(120)}. */
  public static final int MAX_FDU_NAME_LEN = 120;
  /** {@code PLAN_TERM_YEARS} / {@code PLAN_TERM_MONTHS NUMBER(3)}. */
  public static final int MAX_PLAN_TERM_DIGITS = 3;

  /**
   * {@code TELEPHONE_NUMBER VARCHAR2(10)} holds ten characters, so the number
   * has to arrive as bare digits — a separator-formatted "250-720-6237" is 12
   * and overflows the column. Matches the rule the UI edit form already
   * enforces (InformationTab's {@code /^\d{10}$/}).
   */
  private static final String PHONE_PATTERN = "\\d{10}";

  /** True when {@code phone} is exactly ten digits, ignoring surrounding space. */
  public static boolean isValidPhone(String phone) {
    return phone != null && phone.trim().matches(PHONE_PATTERN);
  }

  /** True when {@code value} is null, empty, or whitespace only. */
  public static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  /** Trimmed length, treating null as 0. */
  public static int trimmedLength(String value) {
    return value == null ? 0 : value.trim().length();
  }
}
