package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeStripper;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.validator.SchemaValidator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Drives the mapper against the sanitized Mackenzie TSA fixture so we
 * lock in the header-field translation (FSP id, plan name, term,
 * amendment metadata, FRPA election, contact info on metadata).
 */
class SubmissionToFspRequestMapperTest {

  private static SubmissionXmlParser parser;
  private static SubmissionEnvelopeStripper stripper;
  private final SubmissionToFspRequestMapper mapper = new SubmissionToFspRequestMapper();

  @BeforeAll
  static void wireParser() throws Exception {
    SchemaValidator sv = new SchemaValidator();
    invokePostConstruct(sv, "compileSchema");
    parser = new SubmissionXmlParser(sv);
    invokePostConstruct(parser, "initContext");
    stripper = new SubmissionEnvelopeStripper();
  }

  @Test
  void maps_mackenzie_header_fields() throws Exception {
    FSPSubmissionType submission = parseFixture("valid-mackenzie-96-amend6.xml");

    FspRequest req = mapper.toFspRequest(submission);

    assertThat(req.getFspId()).isEqualTo("96");
    assertThat(req.getFspPlanName()).isEqualTo("Sample Mackenzie TSA FSP");
    assertThat(req.getAmendmentName()).isEqualTo("ARA#6");
    // XML actionCode="A" translates to DB fsp_amendment_code="AMD"
    // (different vocabularies — see SubmissionToFspRequestMapper#mapActionCode).
    assertThat(req.getFspAmendmentCode()).isEqualTo("AMD");
    // From envelope metadata, not from the plan body
    assertThat(req.getFspContactName()).isEqualTo("Test Contact");
    assertThat(req.getFspTelephoneNumber()).isEqualTo("2505550000");
    assertThat(req.getFspEmailAddress()).isEqualTo("test.contact@example.com");
    // VARRAY contents — agreement holders + districts populated from
    // planHolderList + districtCodeList. SAVE proc requires ≥1 holder.
    assertThat(req.getAgreementHolders())
        .extracting(ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest.AgreementHolder::getClientNumber)
        .containsExactly("00001271", "00161366");
    assertThat(req.getDistricts())
        .extracting(ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest.District::getOrgUnitCode)
        .contains("DMK");
  }

  @Test
  void maps_esf_wrapped_to_same_header() throws Exception {
    FSPSubmissionType submission =
        parseFixture("valid-mackenzie-96-amend6-esf-wrapped.xml");

    FspRequest req = mapper.toFspRequest(submission);

    assertThat(req.getFspId()).isEqualTo("96");
    assertThat(req.getAmendmentName()).isEqualTo("ARA#6");
    assertThat(req.getFspContactName()).isEqualTo("Test Contact");
  }

  // -------- helpers --------

  private static FSPSubmissionType parseFixture(String name) throws Exception {
    byte[] raw = new ClassPathResource("fixtures/submissions/" + name)
        .getInputStream().readAllBytes();
    byte[] fspBytes = stripper.toBareFspSubmission(raw);
    SubmissionXmlParser.ParseOutcome outcome = parser.parse(fspBytes);
    if (outcome.submission() == null) {
      throw new IllegalStateException("parse failed for " + name + ": " + outcome.errors());
    }
    return outcome.submission();
  }

  private static void invokePostConstruct(Object bean, String methodName) throws Exception {
    Method m = bean.getClass().getDeclaredMethod(methodName);
    m.setAccessible(true);
    m.invoke(bean);
  }
}
