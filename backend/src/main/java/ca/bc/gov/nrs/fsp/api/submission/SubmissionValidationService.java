package ca.bc.gov.nrs.fsp.api.submission;

import ca.bc.gov.nrs.fsp.api.submission.geojson.SubmissionGeoJsonParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeException;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeStripper;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.validator.ActionCodeContextValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.AgreementHolderValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.DistrictCodeValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.FduUniquenessValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.GeometryValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.IdentifiedAreaValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.LicenceContextValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.PlanNameValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.PlanTermValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Phase-1 validation entry point: schema check → JAXB parse with schema
 * binding → geometry topology check. Business-rule validation and
 * persistence are deferred to later phases.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SubmissionValidationService {

  private final SubmissionEnvelopeStripper envelopeStripper;
  private final SubmissionXmlParser parser;
  private final SubmissionGeoJsonParser geoJsonParser;
  private final GeometryValidator geometryValidator;
  private final ActionCodeContextValidator actionCodeContextValidator;
  private final LicenceContextValidator licenceContextValidator;
  private final PlanTermValidator planTermValidator;
  private final PlanNameValidator planNameValidator;
  private final AgreementHolderValidator agreementHolderValidator;
  private final DistrictCodeValidator districtCodeValidator;
  private final FduUniquenessValidator fduUniquenessValidator;
  private final IdentifiedAreaValidator identifiedAreaValidator;
  private final SubmissionPreviewMapper previewMapper;

  public SubmissionValidationResult validate(byte[] xml) {
    return validateAndParse(xml).result();
  }

  /**
   * Variant that also returns the parsed JAXB tree so callers
   * (notably the persistence path) don't have to re-parse on success.
   * On failure, {@code submission} may be null.
   */
  public ValidationOutcome validateAndParse(byte[] bytes) {
    List<SubmissionValidationError> errors = new ArrayList<>();

    SubmissionXmlParser.ParseOutcome outcome = switch (detectFormat(bytes)) {
      case XML -> parseXml(bytes, errors);
      case GEOJSON -> geoJsonParser.parse(bytes);
      case UNKNOWN -> {
        errors.add(SubmissionValidationError.of(
            "FORMAT_UNRECOGNIZED",
            "could not detect format — expected XML (starts with '<') or"
                + " GeoJSON (starts with '{')"));
        yield new SubmissionXmlParser.ParseOutcome(null, List.of());
      }
    };
    errors.addAll(outcome.errors());

    SubmissionPreview preview = null;
    if (outcome.submission() != null) {
      errors.addAll(geometryValidator.validate(outcome.submission()));
      // Tells the submitter up-front that the referenced FSP can't be
      // amended/replaced because no prior amendment has reached APP
      // or INE status — runs against the same table the proc consults,
      // so a clean validation error replaces the eventual ORA-01403.
      errors.addAll(actionCodeContextValidator.validate(outcome.submission()));
      // Validates every <licenceNumber> against PROV_FOREST_USE so an
      // unknown id is caught here instead of as ORA-02291
      // (FDUL_PFU_FK) during FDU persistence after the FSP_300 header
      // has already been written.
      errors.addAll(licenceContextValidator.validate(outcome.submission()));
      // The XSD allows planTerm{Years,Months} and planTermExpiry
      // independently, but FSP_300_INFORMATION rejects submissions
      // that carry both with FSP.BOTH.PLAN.TERM_OR_END_DATE.
      errors.addAll(planTermValidator.validate(outcome.submission()));
      // Sweep of proc-side business rules a parsed XML alone can
      // settle: required planName on Initial, agreement-holder
      // presence + uniqueness, district presence + existence +
      // uniqueness, FDU/identified-area name uniqueness, and
      // legislationTypeCode allow-list. Each maps to a specific
      // fsp_error.set_error('FSP.*') call in the proc bodies.
      errors.addAll(planNameValidator.validate(outcome.submission()));
      errors.addAll(agreementHolderValidator.validate(outcome.submission()));
      errors.addAll(districtCodeValidator.validate(outcome.submission()));
      errors.addAll(fduUniquenessValidator.validate(outcome.submission()));
      errors.addAll(identifiedAreaValidator.validate(outcome.submission()));
      // Preview is built even when geometry/schema errors are present —
      // the user still benefits from seeing what was parsed alongside
      // the errors that need fixing.
      preview = previewMapper.toPreview(outcome.submission());
    }

    SubmissionValidationResult result = errors.isEmpty()
        ? SubmissionValidationResult.ok(preview)
        : SubmissionValidationResult.failed(errors, preview);
    return new ValidationOutcome(result, outcome.submission());
  }

  /**
   * XML path: strip the ESF envelope if present, then JAXB-parse.
   * Envelope failures bubble up as {@link ValidationOutcome} early
   * exits via the dedicated error code.
   */
  private SubmissionXmlParser.ParseOutcome parseXml(
      byte[] bytes, List<SubmissionValidationError> errors) {
    byte[] fspBytes;
    try {
      fspBytes = envelopeStripper.toBareFspSubmission(bytes);
    } catch (SubmissionEnvelopeException e) {
      errors.add(SubmissionValidationError.of(e.getCode(), e.getMessage()));
      return new SubmissionXmlParser.ParseOutcome(null, List.of());
    }
    return parser.parse(fspBytes);
  }

  /**
   * Cheap leading-byte sniff so the user can drop either format on the
   * same uploader. Skips whitespace + UTF-8 BOM; anything else falls
   * through to {@link Format#UNKNOWN}.
   */
  static Format detectFormat(byte[] bytes) {
    if (bytes == null) return Format.UNKNOWN;
    int i = 0;
    // Skip UTF-8 BOM.
    if (bytes.length >= 3
        && (bytes[0] & 0xFF) == 0xEF
        && (bytes[1] & 0xFF) == 0xBB
        && (bytes[2] & 0xFF) == 0xBF) {
      i = 3;
    }
    while (i < bytes.length) {
      byte b = bytes[i];
      if (b == ' ' || b == '\t' || b == '\n' || b == '\r') {
        i++;
        continue;
      }
      if (b == '<') return Format.XML;
      if (b == '{') return Format.GEOJSON;
      return Format.UNKNOWN;
    }
    return Format.UNKNOWN;
  }

  /** Submission upload format. */
  enum Format { XML, GEOJSON, UNKNOWN }

  public record ValidationOutcome(
      SubmissionValidationResult result, FSPSubmissionType submission) {}
}
