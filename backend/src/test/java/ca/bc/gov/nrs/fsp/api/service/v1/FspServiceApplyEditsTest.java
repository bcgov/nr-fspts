package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code FspService.applyEdits} — the overlay of an Information-tab edit onto
 * the GET-resolved row before FSP_300_INFORMATION SAVE. SAVE only persists
 * P_FSP_PLAN_END_DATE; P_FSP_EXPIRY_DATE is the tombstone's latest-approved
 * expiry and is never read, so an expiry edit must land on the plan end date.
 */
class FspServiceApplyEditsTest {

  private static FspRequest current() {
    return FspRequest.builder()
        .fspPlanStartDate("2020-04-28")
        .fspPlanEndDate("2025-04-28")
        .fspExpiryDate("2025-04-28")
        .build();
  }

  @Test
  void planEndDateEditIsApplied() {
    FspRequest target = current();
    FspService.applyEdits(target, FspRequest.builder().fspPlanEndDate("2030-04-28").build());
    assertThat(target.getFspPlanEndDate()).isEqualTo("2030-04-28");
  }

  @Test
  void expiryDateEditLandsOnThePlanEndDate() {
    FspRequest target = current();
    FspService.applyEdits(target, FspRequest.builder().fspExpiryDate("2030-04-28").build());
    assertThat(target.getFspPlanEndDate()).isEqualTo("2030-04-28");
  }

  @Test
  void explicitPlanEndDateWinsOverExpiryDate() {
    FspRequest target = current();
    FspService.applyEdits(target, FspRequest.builder()
        .fspPlanEndDate("2030-04-28").fspExpiryDate("2029-01-01").build());
    assertThat(target.getFspPlanEndDate()).isEqualTo("2030-04-28");
  }

  @Test
  void clearedEndDateIsSentAsEmpty() {
    FspRequest target = current();
    FspService.applyEdits(target, FspRequest.builder().fspPlanEndDate("").build());
    assertThat(target.getFspPlanEndDate()).isEmpty();
  }

  @Test
  void sparseEditLeavesDatesAlone() {
    FspRequest target = current();
    FspService.applyEdits(target, FspRequest.builder().fspContactName("New Contact").build());
    assertThat(target.getFspPlanEndDate()).isEqualTo("2025-04-28");
  }

  @Test
  void startDateIsNotEditable() {
    FspRequest target = current();
    FspService.applyEdits(target, FspRequest.builder().fspPlanStartDate("2021-01-01").build());
    assertThat(target.getFspPlanStartDate()).isEqualTo("2020-04-28");
  }
}
