package ca.bc.gov.nrs.fsp.api.submission;

import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeException;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeStripper;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.validator.GeometryValidator;
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
  private final GeometryValidator geometryValidator;

  public SubmissionValidationResult validate(byte[] xml) {
    return validateAndParse(xml).result();
  }

  /**
   * Variant that also returns the parsed JAXB tree so callers
   * (notably the persistence path) don't have to re-parse on success.
   * On failure, {@code submission} may be null.
   */
  public ValidationOutcome validateAndParse(byte[] xml) {
    List<SubmissionValidationError> errors = new ArrayList<>();

    byte[] fspBytes;
    try {
      fspBytes = envelopeStripper.toBareFspSubmission(xml);
    } catch (SubmissionEnvelopeException e) {
      errors.add(SubmissionValidationError.of(e.getCode(), e.getMessage()));
      return new ValidationOutcome(SubmissionValidationResult.failed(errors), null);
    }

    SubmissionXmlParser.ParseOutcome outcome = parser.parse(fspBytes);
    errors.addAll(outcome.errors());

    if (outcome.submission() != null) {
      errors.addAll(geometryValidator.validate(outcome.submission()));
    }

    SubmissionValidationResult result = errors.isEmpty()
        ? SubmissionValidationResult.ok()
        : SubmissionValidationResult.failed(errors);
    return new ValidationOutcome(result, outcome.submission());
  }

  public record ValidationOutcome(
      SubmissionValidationResult result, FSPSubmissionType submission) {}
}
