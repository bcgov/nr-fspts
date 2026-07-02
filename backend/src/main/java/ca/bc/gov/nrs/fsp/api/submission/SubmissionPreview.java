package ca.bc.gov.nrs.fsp.api.submission;

import java.util.List;

/**
 * Read-only projection of a parsed FSP submission, sent back as part of
 * {@link SubmissionValidationResult} so the upload UI can render a
 * "here's what you've staged" preview before the user commits to Submit.
 *
 * <p>Pure JSON shape — every value reflects what's in the XML; no
 * downstream-lookup-resolved labels (e.g. district names, client names,
 * status descriptions) are included. Those become available only after
 * persistence and live on {@code FspInformation} instead.
 */
public record SubmissionPreview(
    Metadata metadata,
    PlanHeader plan,
    TermAndDates termAndDates,
    List<AgreementHolderRef> agreementHolders,
    List<DistrictRef> districts,
    List<FduSummary> fdus,
    List<StockingStandardSummary> stockingStandards
) {

  /** Client number paired with its resolved name (null when unknown). */
  public record AgreementHolderRef(String clientNumber, String clientName) {}

  /**
   * District code with its resolved org_unit_no + name. {@code orgUnitNo}
   * is null when the lookup misses (an UNKNOWN-code error surfaces
   * downstream during persistence resolution).
   */
  public record DistrictRef(String orgUnitCode, String orgUnitNo, String orgUnitName) {}

  public record Metadata(
      String contactName,
      String telephoneNumber,
      String emailAddress,
      Integer attachmentCount
  ) {}

  public record PlanHeader(
      String fspId,
      String planName,
      String amendmentName,
      /** The raw XML {@code actionCode} (I / U / A). */
      String actionCode,
      /** Human-friendly translation of {@code actionCode}. */
      String actionDescription,
      Boolean approvalRequired,
      Boolean fduUpdate,
      Boolean stockingStandardUpdate,
      Boolean frpa197,
      Boolean transitional,
      Boolean legalDocConsolidated
  ) {}

  public record TermAndDates(
      String planStartDate,
      Integer planTermYears,
      Integer planTermMonths,
      String planExpiryDate,
      String amendmentComment
  ) {}

  public record FduSummary(
      String name,
      int licenceCount,
      int polygonCount,
      /** SRS name from the GML extent — verbatim, e.g. "EPSG:42102". */
      String srsName
  ) {}

  public record StockingStandardSummary(
      String id,
      String name,
      String objective,
      String bgcSummary,
      int bgcCount,
      int layerCount
  ) {}
}
