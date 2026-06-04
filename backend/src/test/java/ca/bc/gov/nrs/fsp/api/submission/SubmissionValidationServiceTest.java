package ca.bc.gov.nrs.fsp.api.submission;

import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeStripper;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.validator.GeometryValidator;
import ca.bc.gov.nrs.fsp.api.submission.validator.SchemaValidator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Drives the schema validator + JAXB parser + geometry validator
 * chain end-to-end on canned XML fixtures. The dependencies are wired
 * manually here — no Spring context — so the test stays fast and
 * the same pipeline that the controller exercises gets exercised
 * directly.
 */
class SubmissionValidationServiceTest {

  private static SubmissionValidationService service;

  @BeforeAll
  static void wirePipeline() throws Exception {
    SchemaValidator schemaValidator = new SchemaValidator();
    invokePostConstruct(schemaValidator, "compileSchema");

    SubmissionXmlParser parser = new SubmissionXmlParser(schemaValidator);
    invokePostConstruct(parser, "initContext");

    service = new SubmissionValidationService(
        new SubmissionEnvelopeStripper(),
        parser,
        new GeometryValidator(new GmlGeometryConverter()));
  }

  @Test
  void rejects_root_with_no_children() throws IOException {
    SubmissionValidationResult result = service.validate(read("missing-required-children.xml"));

    assertThat(result.valid()).isFalse();
    assertThat(result.errors()).isNotEmpty();
    assertThat(result.errors())
        .extracting(SubmissionValidationError::code)
        .anyMatch(c -> c.equals("XSD") || c.equals("JAXB"));
  }

  @Test
  void rejects_malformed_xml() throws IOException {
    SubmissionValidationResult result = service.validate(read("malformed.xml"));

    assertThat(result.valid()).isFalse();
    assertThat(result.errors()).isNotEmpty();
  }

  @Test
  void rejects_empty_byte_array() {
    SubmissionValidationResult result = service.validate(new byte[0]);

    assertThat(result.valid()).isFalse();
    assertThat(result.errors()).isNotEmpty();
  }

  @Test
  void accepts_real_mackenzie_submission() throws IOException {
    SubmissionValidationResult result =
        service.validate(read("valid-mackenzie-96-amend6.xml"));

    assertThat(result.errors())
        .as("real production submission should pass schema + geometry validation")
        .isEmpty();
    assertThat(result.valid()).isTrue();
  }

  @Test
  void accepts_esf_wrapped_submission() throws IOException {
    // Same body as the bare fixture above but inside the legacy
    // <esf:ESFSubmission>/<esf:submissionContent> envelope. The
    // envelope-stripper should unwrap it transparently.
    SubmissionValidationResult result =
        service.validate(read("valid-mackenzie-96-amend6-esf-wrapped.xml"));

    assertThat(result.errors())
        .as("ESF-wrapped submission should be unwrapped and validated identically")
        .isEmpty();
    assertThat(result.valid()).isTrue();
  }

  @Test
  void rejects_unknown_root_element() {
    byte[] junk = ("<?xml version=\"1.0\"?>"
        + "<somethingElse xmlns=\"http://example.com/other\"/>")
        .getBytes();
    SubmissionValidationResult result = service.validate(junk);

    assertThat(result.valid()).isFalse();
    assertThat(result.errors()).hasSize(1);
    assertThat(result.errors().get(0).code()).isEqualTo("ENVELOPE_UNRECOGNIZED");
  }

  // -------- helpers --------

  private static byte[] read(String fixture) throws IOException {
    return new ClassPathResource("fixtures/submissions/" + fixture)
        .getInputStream()
        .readAllBytes();
  }

  /** Invoke a package-private @PostConstruct method to mirror Spring's wiring. */
  private static void invokePostConstruct(Object bean, String methodName) throws Exception {
    Method m = bean.getClass().getDeclaredMethod(methodName);
    m.setAccessible(true);
    m.invoke(bean);
  }
}
