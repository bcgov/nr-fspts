package ca.bc.gov.nrs.fsp.api.exception;

import org.springframework.http.HttpStatus;

import java.util.Map;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.CONFLICT;
import static org.springframework.http.HttpStatus.FORBIDDEN;
import static org.springframework.http.HttpStatus.NOT_FOUND;

/**
 * Curated user-facing messages + HTTP status for the legacy proc error
 * codes ({@code FSP.*} / {@code sil.web.*}). Shared between
 * {@link RestExceptionHandler} (which substring-matches against the
 * Oracle error string to translate exceptions) and the Submit preflight
 * (which gets the codes back as discrete strings from
 * {@code fsp_error.get_error_keys}).
 *
 * <p>Single source of truth for the curated codes — add a new entry
 * here and both consumers pick it up.
 */
public final class ProcErrorMessages {

  private ProcErrorMessages() {}

  public record Info(HttpStatus status, String message) {}

  /** Look up the full info for a curated code, or {@code null} if unknown. */
  public static Info infoFor(String code) {
    if (code == null) return null;
    return CODES.get(code);
  }

  /** Look up the user-facing message, or {@code null} if the code isn't curated. */
  public static String messageFor(String code) {
    Info info = infoFor(code);
    return info == null ? null : info.message();
  }

  /**
   * Substring search across the curated codes — used by the exception
   * handler against full Oracle error strings that wrap the code in
   * package paths and call stacks.
   */
  public static String firstMatchedCode(String oracleMessage) {
    if (oracleMessage == null) return null;
    for (String code : CODES.keySet()) {
      if (oracleMessage.contains(code)) return code;
    }
    return null;
  }

  /** Read-only view of every curated code → info pair. */
  public static Map<String, Info> all() {
    return CODES;
  }

  private static final Map<String, Info> CODES = Map.ofEntries(
      // Raised by fsp_tombstone whenever user_may_access returns 'N' OR a
      // tombstone GET hits NO_DATA_FOUND because the role/client combo
      // isn't allowed to see the row. We lean toward the 403 framing
      // because the common case in BCeID submitter traffic is "FSP
      // exists but you're not on it".
      Map.entry("fsp.web.error.no_access_right", new Info(FORBIDDEN,
          "You don't have access to this FSP. It either doesn't exist or "
              + "belongs to an organization you're not signed in under.")),
      // Ownership is fine but the FSP's status doesn't permit a direct content
      // edit (e.g. a Submitter on an Approved / In-Effect plan). Distinct from
      // no_access_right so the user isn't wrongly told it's an org problem.
      Map.entry("fsp.web.error.not_editable_status", new Info(FORBIDDEN,
          "This FSP can't be edited directly in its current status. To change "
              + "an approved or in-effect plan, create an amendment.")),
      Map.entry("FSP.INVALID.AGREEMENT.HOLDER", new Info(FORBIDDEN,
          "Your client number is not on this FSP's agreement holder list, so "
              + "you can't modify it. An agreement holder for this FSP needs "
              + "to make the change.")),
      Map.entry("FSP.NO.AGREEMENT.HOLDER", new Info(BAD_REQUEST,
          "FSP must have at least one agreement holder.")),
      Map.entry("FSP.BAD.ORG.UNIT", new Info(BAD_REQUEST,
          "One of the supplied district codes isn't recognized.")),
      Map.entry("FSP.NO.ORG.UNIT", new Info(BAD_REQUEST,
          "FSP must have at least one district code.")),
      Map.entry("FSP.NO.NAME", new Info(BAD_REQUEST,
          "Plan name is required.")),
      Map.entry("FSP.NO.CONTACT.PERSON", new Info(BAD_REQUEST,
          "Contact name is required.")),
      Map.entry("FSP.NO.CONTACT.PHONE", new Info(BAD_REQUEST,
          "Contact telephone number is required.")),
      Map.entry("FSP.NO.CONTACT.EMAIL", new Info(BAD_REQUEST,
          "Contact email address is required.")),
      // FSP.INVALID.PLAN.TERM.SHORT is misnamed in the legacy proc — it
      // fires for negative years, negative months, AND a term over the
      // 5-year (60-month) cap.
      Map.entry("FSP.INVALID.PLAN.TERM.SHORT", new Info(BAD_REQUEST,
          "Plan term must be 0 or greater and can't exceed 5 years total "
              + "(60 months).")),
      Map.entry("FSP.NO.PLAN.TERM.AND.EXPIRY", new Info(BAD_REQUEST,
          "Enter either a plan term (years/months) or a plan end date.")),
      Map.entry("FSP.BOTH.PLAN.TERM_OR_END_DATE", new Info(BAD_REQUEST,
          "Enter either a plan term (years/months) or a plan end date — "
              + "not both.")),
      Map.entry("FSP.INVALID.EXT.END.DATE.SHORT", new Info(BAD_REQUEST,
          "Plan end date can't be more than 5 years after the effective "
              + "date.")),
      Map.entry("FSP.CANNOT.APPROVE.NO_FDU_INCLUDED", new Info(BAD_REQUEST,
          "Submission must include at least one FDU.")),
      Map.entry("FSP.CANNOT.APPROVE.NO_STANDARDS_INCLUDED", new Info(BAD_REQUEST,
          "Submission must include at least one stocking standard.")),
      Map.entry("FSP.CANNOT.APPROVE.NO_SPATIAL_ATTACHED", new Info(BAD_REQUEST,
          "FDU spatial data is required.")),
      Map.entry("FSP.CANNOT.APPROVE.NO_FDU_SPATIAL_ATTACHED", new Info(BAD_REQUEST,
          "FDU spatial data is required.")),
      Map.entry("FSP.CANNOT.APPROVE.NO_IA_SPATIAL_ATTACHED", new Info(BAD_REQUEST,
          "Identified-areas spatial data is required.")),
      Map.entry("FSP.CANNOT.APPROVE.NO_IDENT_AREA_INCLUDED", new Info(BAD_REQUEST,
          "Submission must include at least one identified area.")),
      Map.entry("FSP.CANNOT.APPROVE_OR_REJECT.NO_DMD_LETTER", new Info(BAD_REQUEST,
          "A decision-letter attachment is required.")),
      // Note: the proc misspells "attachment" as "ATTACHEMENT" — match
      // exactly. Fires from fsp_common_validation.validate_fsp during
      // SUBMIT and the DDM approve/reject paths when no attachment of
      // type_code='FSP' exists on the amendment. The DDM Decision
      // document (DDMD) is a separate attachment and does not satisfy
      // this check.
      Map.entry("FSP.NO.ATTACHEMENT.FOUND", new Info(BAD_REQUEST,
          "Upload the FSP plan document on the Attachments tab "
              + "(category \"FSP Document\") before approving — the "
              + "DDM Decision Document is a separate, additional "
              + "attachment.")),
      Map.entry("FSP.DUPLICATE.AGREEMENT.HOLDER", new Info(BAD_REQUEST,
          "Agreement holder list contains duplicates.")),
      Map.entry("FSP.DUPLICATE.FDU.NAME", new Info(BAD_REQUEST,
          "FDU names must be unique within the submission.")),
      Map.entry("FSP.DUPLICATE.IDENTIFIED.AREA.NAME", new Info(BAD_REQUEST,
          "Identified-area names must be unique within the submission.")),
      Map.entry("FSP.INVALID.LEGISLATION.TYPE", new Info(BAD_REQUEST,
          "Identified-area legislationTypeCode must be FRPA196(1), "
              + "FRPA196(2), or FPPR14(4).")),
      Map.entry("FSP.NO.APPROVAL.IND", new Info(BAD_REQUEST,
          "Approval-required indicator must be set.")),
      Map.entry("FSP.NO.FDU.NAME", new Info(BAD_REQUEST,
          "Every FDU must have a name.")),
      Map.entry("FSP.NO.IDENTIFIED.AREA.NAME", new Info(BAD_REQUEST,
          "Every identified area must have a name.")),
      Map.entry("FSP.NO.FDU.LICENCE", new Info(BAD_REQUEST,
          "Each FDU must have at least one licence number (BCTS exempt).")),
      Map.entry("FSP.BAD.FDU.LICENCE", new Info(BAD_REQUEST,
          "One of the supplied FDU licence numbers isn't recognized.")),
      Map.entry("FSP.INVALID.FDU.LICENCE", new Info(BAD_REQUEST,
          "One of the supplied FDU licence numbers isn't recognized.")),
      Map.entry("sil.web.error.usr.noRecord", new Info(NOT_FOUND,
          "The requested record could not be found.")),
      Map.entry("sil.web.usr.database.record.modified", new Info(CONFLICT,
          "This record was modified by someone else after you opened it. "
              + "Reload and try again.")));
}
