package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.PlanHolderAssociationType;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the {@code SUBMITTER_NOT_AGREEMENT_HOLDER} rule of
 * {@link AgreementHolderValidator}, which surfaces
 * {@code FSP.INVALID.AGREEMENT.HOLDER} at validation time instead of on SAVE.
 */
class AgreementHolderValidatorTest {

  private final FduWriteDao fduWriteDao = Mockito.mock(FduWriteDao.class);
  private final AgreementHolderValidator validator = new AgreementHolderValidator(fduWriteDao);
  private MockedStatic<RequestUtil> requestUtil;

  @BeforeEach
  void setUp() {
    Mockito.when(fduWriteDao.clientExists(Mockito.anyString())).thenReturn(true);
    requestUtil = Mockito.mockStatic(RequestUtil.class);
  }

  @AfterEach
  void tearDown() {
    requestUtil.close();
  }

  private void signedInAs(String clientNumber, boolean admin) {
    requestUtil.when(RequestUtil::getCurrentClientNumber).thenReturn(clientNumber);
    requestUtil.when(RequestUtil::isCurrentUserAdmin).thenReturn(admin);
  }

  @Test
  void clientOnHolderList_isAccepted() {
    signedInAs("00012345", false);
    assertThat(validator.validate(submission(ActionCodeType.A, "00099999", "00012345")))
        .isEmpty();
  }

  @Test
  void clientNotOnHolderList_isRejected() {
    signedInAs("00012345", false);
    List<SubmissionValidationError> errors =
        validator.validate(submission(ActionCodeType.A, "00099999"));
    assertThat(errors).extracting(SubmissionValidationError::code)
        .containsExactly("SUBMITTER_NOT_AGREEMENT_HOLDER");
    assertThat(errors.get(0).message()).contains("00012345");
  }

  @Test
  void omittedHolderList_isRejectedForClientUser() {
    signedInAs("00012345", false);
    assertThat(validator.validate(submission(ActionCodeType.A)))
        .extracting(SubmissionValidationError::code)
        .containsExactly("SUBMITTER_NOT_AGREEMENT_HOLDER");
  }

  @Test
  void adminAndInternalUsers_skipTheCheck() {
    signedInAs("00012345", true);
    assertThat(validator.validate(submission(ActionCodeType.A, "00099999"))).isEmpty();
    signedInAs("", false);
    assertThat(validator.validate(submission(ActionCodeType.A, "00099999"))).isEmpty();
  }

  @Test
  void droppingHolderWithFdus_isRejected_holdersWithoutFdusMayBeDropped() {
    signedInAs("", false);
    Mockito.when(fduWriteDao.findMaxApprovedAmendmentNumber(969L)).thenReturn(0L);
    Mockito.when(fduWriteDao.findAgreementHolderFduLicenceCounts(969L, 0L))
        .thenReturn(java.util.Map.of("00001271", 9, "00004238", 0));
    FSPSubmissionType sub = submission(ActionCodeType.A, "00170240");
    sub.getSubmissionItem().getForestStewardshipPlan().setFspID(969L);

    List<SubmissionValidationError> errors = validator.validate(sub);

    assertThat(errors).extracting(SubmissionValidationError::code)
        .containsExactly("AGREEMENT_HOLDER_HAS_FDUS");
    assertThat(errors.get(0).message()).contains("00001271").contains("9 FDU");
  }

  @Test
  void keepingHolderWithFdus_isAccepted() {
    signedInAs("", false);
    Mockito.when(fduWriteDao.findMaxApprovedAmendmentNumber(969L)).thenReturn(0L);
    Mockito.when(fduWriteDao.findAgreementHolderFduLicenceCounts(969L, 0L))
        .thenReturn(java.util.Map.of("00001271", 9));
    FSPSubmissionType sub = submission(ActionCodeType.A, "00001271");
    sub.getSubmissionItem().getForestStewardshipPlan().setFspID(969L);

    assertThat(validator.validate(sub)).isEmpty();
  }

  private static FSPSubmissionType submission(ActionCodeType action, String... clientCodes) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setActionCode(action);
    if (clientCodes.length > 0) {
      PlanHolderAssociationType holders = new PlanHolderAssociationType();
      holders.getClientCode().addAll(List.of(clientCodes));
      plan.setPlanHolderList(holders);
    }
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }
}
