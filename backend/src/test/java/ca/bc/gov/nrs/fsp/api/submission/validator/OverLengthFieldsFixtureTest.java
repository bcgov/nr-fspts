package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.geojson.SubmissionGeoJsonParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Drives the length rules through the real GeoJSON parser using the
 * {@code over-length-fields.geojson} fixture, in which every free-text field
 * is one character over its column limit.
 *
 * <p>The per-validator unit tests build the JAXB model by hand, so they cannot
 * catch a parser that stops populating the field a validator reads — the rule
 * would keep passing its own tests while silently never firing on a real
 * upload. That gap is the point of this test: it asserts the GeoJSON property
 * names submitters actually write ({@code planName}, {@code amendmentName},
 * {@code submissionMetadata.*}, and a feature's {@code name}) still reach the
 * validators. {@code amendmentName} is the one most at risk, since the parser
 * has to wrap it in a {@code JAXBElement} for the validator to see it.
 */
class OverLengthFieldsFixtureTest {

  private final SubmissionGeoJsonParser parser =
      new SubmissionGeoJsonParser(new ObjectMapper());

  @Test
  void everyOverLengthField_isReportedInOnePass() throws IOException {
    SubmissionXmlParser.ParseOutcome outcome = parser.parse(read("over-length-fields.geojson"));

    // The fixture is structurally valid GeoJSON — the only problems are
    // lengths, which are caught downstream by the validators, not the parser.
    assertThat(outcome.errors()).isEmpty();
    assertThat(outcome.submission()).isNotNull();

    List<SubmissionValidationError> errors = new ArrayList<>();
    errors.addAll(new PlanNameValidator().validate(outcome.submission()));
    errors.addAll(new AmendmentNameValidator().validate(outcome.submission()));
    errors.addAll(new ContactDetailsValidator().validate(outcome.submission()));
    errors.addAll(new FduNameValidator().validate(outcome.submission()));

    assertThat(errors.stream().map(SubmissionValidationError::code).toList())
        .containsExactlyInAnyOrder(
            "PLAN_NAME_TOO_LONG",
            "AMENDMENT_NAME_TOO_LONG",
            "CONTACT_NAME_TOO_LONG",
            "CONTACT_PHONE_INVALID",
            "CONTACT_EMAIL_TOO_LONG",
            "FDU_NAME_TOO_LONG");
  }

  @Test
  void theKnownGoodFixture_stillPassesEveryLengthRule() throws IOException {
    // Guards the other direction: the rules must not reject the valid
    // submission the rest of the suite is built on.
    SubmissionXmlParser.ParseOutcome outcome =
        parser.parse(read("valid-mackenzie-96-amend6.geojson"));
    assertThat(outcome.submission()).isNotNull();

    assertThat(new PlanNameValidator().validate(outcome.submission())).isEmpty();
    assertThat(new AmendmentNameValidator().validate(outcome.submission())).isEmpty();
    assertThat(new ContactDetailsValidator().validate(outcome.submission())).isEmpty();
    assertThat(new FduNameValidator().validate(outcome.submission())).isEmpty();
  }

  private static byte[] read(String fixture) throws IOException {
    try (InputStream in = OverLengthFieldsFixtureTest.class
        .getResourceAsStream("/fixtures/submissions/" + fixture)) {
      assertThat(in).as("fixture %s is on the test classpath", fixture).isNotNull();
      return in.readAllBytes();
    }
  }
}
