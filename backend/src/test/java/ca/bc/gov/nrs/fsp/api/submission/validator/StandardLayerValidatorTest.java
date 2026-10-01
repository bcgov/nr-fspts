package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPStandardsType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerListAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardsAssociationType;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link StandardLayerValidator}. A layer with no
 * {@code stockingLayerCode} is schema-valid but violates the NOT NULL on
 * {@code STANDARDS_REGIME_LAYER.STOCKING_LAYER_CODE}, which surfaced as a raw
 * {@code ORA-01400} 500 from {@code FSP_550_SUB_LAYERS.ADD} at persist time.
 */
class StandardLayerValidatorTest {

  private final StandardLayerValidator validator = new StandardLayerValidator();

  @Test
  void allLayersCoded_isAccepted() {
    assertThat(validator.validate(submission(regime("Std A", "1", "2", "3")))).isEmpty();
  }

  @Test
  void missingCode_isRejected() {
    List<SubmissionValidationError> errors =
        validator.validate(submission(regime("Std A", "I"), regime("Std B", "1", null)));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("STOCKING_LAYER_CODE_REQUIRED");
    assertThat(errors.get(0).message()).contains("Layer #2").contains("\"Std B\"");
    assertThat(errors.get(0).path()).isEqualTo(
        "forestStewardshipPlan/stockingStandards/newFSPStandardsList/fSPStandard[1]"
            + "/standardLayerList[0]/standardLayer[1]/stockingLayerCode");
  }

  @Test
  void blankCode_isRejected_andUnnamedRegimeFallsBackToIndex() {
    List<SubmissionValidationError> errors = validator.validate(submission(regime(null, "  ")));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).message()).contains("stocking standard #1");
  }

  @Test
  void noStandards_isAccepted() {
    assertThat(validator.validate(submission())).isEmpty();
    assertThat(validator.validate(null)).isEmpty();
  }

  private static FSPStandardsType regime(String name, String... codes) {
    StandardLayerListAssociationType wrapper = new StandardLayerListAssociationType();
    for (String code : codes) {
      StandardLayerType layer = new StandardLayerType();
      layer.setStockingLayerCode(code);
      wrapper.getStandardLayer().add(layer);
    }
    FSPStandardsType regime = new FSPStandardsType();
    regime.setStandardsRegimeName(name);
    regime.getStandardLayerList().add(wrapper);
    return regime;
  }

  private static FSPSubmissionType submission(FSPStandardsType... regimes) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    if (regimes.length > 0) {
      StandardsAssociationType.NewFSPStandardsList list =
          new StandardsAssociationType.NewFSPStandardsList();
      list.getFSPStandard().addAll(List.of(regimes));
      StandardsAssociationType standards = new StandardsAssociationType();
      standards.setNewFSPStandardsList(list);
      plan.setStockingStandards(standards);
    }
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }
}
