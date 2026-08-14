package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.struct.v1.FspCreateRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;

/**
 * Unit tests for {@code FspService.createFsp} — the "Create FSP" dialog's
 * server-side rules.
 *
 * <p>{@link FspService#create(FspRequest)} is stubbed out: what matters here is
 * that a bad payload never reaches the proc (where an over-long value returns
 * as an opaque {@code ORA-12899} 500), that every problem is reported in one
 * pass rather than one-at-a-time, and that a valid payload is mapped onto the
 * proc-facing DTO the way the submission pipeline maps an Initial submission.
 */
class FspServiceCreateTest {

  private FspService service;

  @BeforeEach
  void setUp() {
    // Only createFsp's own logic is under test; create(FspRequest) is the
    // already-covered proc call, so it's stubbed to echo an assigned id.
    service = spy(new FspService(
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.Fsp100SearchDao.class),
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.FspSearchDirectDao.class),
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.Fsp300InformationDao.class),
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.FspValidationDao.class),
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao.class),
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.FspExtensionQueryDao.class),
        mock(ca.bc.gov.nrs.fsp.api.security.FspAccessGuard.class),
        mock(ca.bc.gov.nrs.fsp.api.client.FomByFspClient.class)));
    org.mockito.Mockito.doReturn(
        FspRequest.builder().fspId("1234").fspAmendmentNumber("0").build())
        .when(service).create(any(FspRequest.class));
    authAsSubmitter("00012797");
  }

  @AfterEach
  void clearAuth() {
    SecurityContextHolder.clearContext();
  }

  // ── happy path + mapping ─────────────────────────────────────────────

  @Test
  void createsAndReturnsTheAssignedId() {
    var created = service.createFsp(valid().build());

    assertThat(created.fspId()).isEqualTo("1234");
    assertThat(created.fspAmendmentNumber()).isEqualTo("0");
  }

  @Test
  void mapsOntoTheProcDtoLikeAnInitialSubmission() {
    service.createFsp(valid().build());

    ArgumentCaptor<FspRequest> captor = ArgumentCaptor.forClass(FspRequest.class);
    verify(service).create(captor.capture());
    FspRequest sent = captor.getValue();

    assertThat(sent.getFspPlanName()).isEqualTo("Test Plan");
    assertThat(sent.getFspTelephoneNumber()).isEqualTo("2507206237");
    // An Initial plan is an "original" row, not an amendment.
    assertThat(sent.getFspAmendmentCode()).isEqualTo("ORG");
    // Transitional is deprecated and hard-coded off, as on the submission path.
    assertThat(sent.getTransitionInd()).isEqualTo("N");
    assertThat(sent.getFrpa197electionInd()).isEqualTo("N");
    assertThat(sent.getAgreementHolders()).hasSize(1);
    assertThat(sent.getAgreementHolders().get(0).getClientNumber()).isEqualTo("00012797");
    // org_unit_no in the FIRST slot — save_org_units reads only that, so a
    // code here would insert a district with a null number.
    assertThat(sent.getDistricts()).hasSize(1);
    assertThat(sent.getDistricts().get(0).getOrgUnitNo()).isEqualTo("15");
  }

  @Test
  void trimsFieldsBeforeSending() {
    service.createFsp(valid().planName("  Test Plan  ")
        .telephoneNumber(" 2507206237 ").build());

    ArgumentCaptor<FspRequest> captor = ArgumentCaptor.forClass(FspRequest.class);
    verify(service).create(captor.capture());
    assertThat(captor.getValue().getFspPlanName()).isEqualTo("Test Plan");
    assertThat(captor.getValue().getFspTelephoneNumber()).isEqualTo("2507206237");
  }

  @Test
  void acceptsAnEndDateInsteadOfATerm() {
    assertThatCode(() -> service.createFsp(
        valid().planTermYears(null).planTermMonths(null).planEndDate("2031-03-31").build()))
        .doesNotThrowAnyException();
  }

  // ── field rules ──────────────────────────────────────────────────────

  @Test
  void rejectsAnEmptyPayloadWithEveryProblemAtOnce() {
    // One round-trip should tell the submitter everything that's wrong.
    assertThatThrownBy(() -> service.createFsp(new FspCreateRequest()))
        .isInstanceOf(IllegalArgumentException.class)
        .satisfies(e -> assertThat(e.getMessage())
            .contains("Plan name is required.")
            .contains("Contact name is required.")
            .contains("Contact telephone number is required.")
            .contains("Contact email address is required.")
            .contains("At least one agreement holder is required.")
            .contains("At least one district is required.")
            .contains("plan term"));

    verify(service, never()).create(any());
  }

  @Test
  void rejectsAnOverLongPlanName() {
    assertThatThrownBy(() -> service.createFsp(valid().planName("x".repeat(121)).build()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("120");
    verify(service, never()).create(any());
  }

  @Test
  void acceptsAPlanNameAtExactlyTheLimit() {
    assertThatCode(() -> service.createFsp(valid().planName("x".repeat(120)).build()))
        .doesNotThrowAnyException();
  }

  @Test
  void rejectsASeparatorFormattedPhone() {
    // The production failure this whole rule exists for: 12 chars into a
    // VARCHAR2(10).
    assertThatThrownBy(() -> service.createFsp(valid().telephoneNumber("250-720-6237").build()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("exactly 10 digits");
  }

  @Test
  void rejectsBothTermAndEndDate() {
    assertThatThrownBy(() -> service.createFsp(valid().planEndDate("2031-03-31").build()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("not both");
  }

  @Test
  void rejectsANonNumericPlanTerm() {
    assertThatThrownBy(() -> service.createFsp(valid().planTermYears("five").build()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("whole number");
  }

  @Test
  void rejectsADistrictGivenAsAThreeLetterCode() {
    // save_org_units reads only p_org_units(i).org_unit_no, so a code would
    // insert a district with a null number instead of failing loudly. The
    // dialog sources numbers from the same list the FSP details "Add
    // district" picker uses; anything else is a caller bug worth naming.
    assertThatThrownBy(() ->
        service.createFsp(valid().districtOrgUnitNos(List.of("DSI")).build()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("org unit number");

    verify(service, never()).create(any());
  }

  @Test
  void rejectsDuplicateHoldersAndDistricts() {
    assertThatThrownBy(() -> service.createFsp(valid()
        .agreementHolderClientNumbers(List.of("00012797", "00012797"))
        .districtOrgUnitNos(List.of("15", "15")).build()))
        .isInstanceOf(IllegalArgumentException.class)
        .satisfies(e -> assertThat(e.getMessage())
            .contains("Agreement holders must be unique.")
            .contains("Districts must be unique."));
  }

  @Test
  void ignoresBlankEntriesInTheHolderAndDistrictLists() {
    // The dialog's chip inputs can leave empties behind; they shouldn't
    // become empty VARRAY rows.
    service.createFsp(valid()
        .agreementHolderClientNumbers(java.util.Arrays.asList("00012797", "  ", null))
        .districtOrgUnitNos(java.util.Arrays.asList("15", "")).build());

    ArgumentCaptor<FspRequest> captor = ArgumentCaptor.forClass(FspRequest.class);
    verify(service).create(captor.capture());
    assertThat(captor.getValue().getAgreementHolders()).hasSize(1);
    assertThat(captor.getValue().getDistricts()).hasSize(1);
  }

  // ── agreement-holder membership ──────────────────────────────────────

  @Test
  void rejectsWhenASubmittersOwnOrgIsNotAnAgreementHolder() {
    // FSP_300_INFORMATION raises FSP.INVALID.AGREEMENT.HOLDER for this;
    // pre-checking it turns a bare proc code into a sentence.
    assertThatThrownBy(() -> service.createFsp(
        valid().agreementHolderClientNumbers(List.of("00099999")).build()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("00012797")
        .hasMessageContaining("agreement holders");
    verify(service, never()).create(any());
  }

  @Test
  void allowsASubmitterToAddOtherHoldersAlongsideTheirOwn() {
    assertThatCode(() -> service.createFsp(valid()
        .agreementHolderClientNumbers(List.of("00099999", "00012797")).build()))
        .doesNotThrowAnyException();
  }

  @Test
  void administratorsAreNotHeldToTheMembershipRule() {
    // The proc passes an empty client number for admins, which Oracle reads
    // as NULL and skips the check — so we must not add one of our own.
    authAsAdministrator();
    assertThatCode(() -> service.createFsp(
        valid().agreementHolderClientNumbers(List.of("00099999")).build()))
        .doesNotThrowAnyException();
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** A payload that passes every rule, for a Submitter at client 00012797. */
  private static Builder valid() {
    return new Builder();
  }

  /** Small fluent builder — FspCreateRequest is a plain mutable DTO. */
  private static final class Builder {
    private final FspCreateRequest body = new FspCreateRequest();

    private Builder() {
      body.setPlanName("Test Plan");
      body.setContactName("Jane Forester");
      body.setTelephoneNumber("2507206237");
      body.setEmailAddress("jane@example.com");
      body.setAgreementHolderClientNumbers(List.of("00012797"));
      body.setDistrictOrgUnitNos(List.of("15"));
      body.setPlanTermYears("5");
      body.setPlanTermMonths("0");
    }

    Builder planName(String v) {
      body.setPlanName(v);
      return this;
    }

    Builder telephoneNumber(String v) {
      body.setTelephoneNumber(v);
      return this;
    }

    Builder planTermYears(String v) {
      body.setPlanTermYears(v);
      return this;
    }

    Builder planTermMonths(String v) {
      body.setPlanTermMonths(v);
      return this;
    }

    Builder planEndDate(String v) {
      body.setPlanEndDate(v);
      return this;
    }

    Builder agreementHolderClientNumbers(List<String> v) {
      body.setAgreementHolderClientNumbers(v);
      return this;
    }

    Builder districtOrgUnitNos(List<String> v) {
      body.setDistrictOrgUnitNos(v);
      return this;
    }

    FspCreateRequest build() {
      return body;
    }
  }

  /**
   * The active-org client number is carried as the group-name suffix
   * ({@code FSPTS_SUBMITTER_00012797}), not as a separate claim — see
   * {@code RequestUtil.collectClientNumberSuffixes}.
   */
  private static void authAsSubmitter(String clientNumber) {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("cognito:groups", List.of("FSPTS_SUBMITTER_" + clientNumber))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }

  private static void authAsAdministrator() {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("cognito:groups", List.of("FSPTS_ADMINISTRATOR"))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }
}
