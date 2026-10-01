package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPStandardsType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerListAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardsAssociationType;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Rules on the layers of each new stocking standard in a submission.
 *
 * <p><b>Stocking layer code required</b> — the XSD marks
 * {@code standardLayer/stockingLayerCode} as {@code minOccurs="0"}, but
 * {@code STANDARDS_REGIME_LAYER.STOCKING_LAYER_CODE} is NOT NULL. A layer
 * without one passed schema validation and then failed inside
 * {@code FSP_550_SUB_LAYERS.ADD} with a raw {@code ORA-01400} 500 at persist
 * time, after the plan and regime rows had already been written.
 */
@Component
public class StandardLayerValidator {

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) return errors;
    StandardsAssociationType standards = plan.getStockingStandards();
    if (standards == null
        || standards.getNewFSPStandardsList() == null
        || standards.getNewFSPStandardsList().getFSPStandard() == null) {
      return errors;
    }

    List<FSPStandardsType> regimes = standards.getNewFSPStandardsList().getFSPStandard();
    for (int r = 0; r < regimes.size(); r++) {
      FSPStandardsType regime = regimes.get(r);
      if (regime == null || regime.getStandardLayerList() == null) continue;
      // Layers are numbered across every standardLayerList wrapper so the
      // message matches the order the user sees them in the file.
      int layerIndex = 0;
      List<StandardLayerListAssociationType> wrappers = regime.getStandardLayerList();
      for (int w = 0; w < wrappers.size(); w++) {
        StandardLayerListAssociationType wrapper = wrappers.get(w);
        if (wrapper == null || wrapper.getStandardLayer() == null) continue;
        List<StandardLayerType> layers = wrapper.getStandardLayer();
        for (int l = 0; l < layers.size(); l++, layerIndex++) {
          StandardLayerType layer = layers.get(l);
          if (layer == null) continue;
          String code = layer.getStockingLayerCode();
          if (code == null || code.isBlank()) {
            errors.add(SubmissionValidationError.of(
                "forestStewardshipPlan/stockingStandards/newFSPStandardsList/fSPStandard["
                    + r + "]/standardLayerList[" + w + "]/standardLayer[" + l
                    + "]/stockingLayerCode",
                "STOCKING_LAYER_CODE_REQUIRED",
                "Layer #" + (layerIndex + 1) + " of stocking standard "
                    + describe(regime, r) + " is missing a stocking layer code."));
          }
        }
      }
    }
    return errors;
  }

  private static String describe(FSPStandardsType regime, int index) {
    String name = regime.getStandardsRegimeName();
    return name == null || name.isBlank()
        ? "#" + (index + 1)
        : "\"" + name.trim() + "\"";
  }
}
