package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.service.v1.CodeListsService;
import ca.bc.gov.nrs.fsp.api.struct.v1.CodeOption;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPStandardsType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerListAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerSpeciesListAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerSpeciesType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardsAssociationType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Checks every {@code standardLayerSpecies/speciesCode} of the new stocking
 * standards against the tree species code list (the same list the Standards
 * screen's species dropdown offers).
 *
 * <p>{@code STANDARDS_REGIME_LAYER_SPECIES.SILV_TREE_SPECIES_CODE} has an FK to
 * {@code SILV_TREE_SPECIES_CODE} ({@code SRLS_STSC_FK}). An unknown code
 * otherwise fails inside {@code FSP_550_SUB_SPECIES} with a raw
 * {@code ORA-02291} at persist time. Codes are stored upper-case while
 * submissions often carry mixed case ({@code Bl}, {@code Sx}), so codes are
 * compared — and persisted — via {@link #normalize}.
 */
@Component
@RequiredArgsConstructor
public class SpeciesCodeValidator {

  private final CodeListsService codeListsService;

  /** Trimmed, upper-cased species code, or {@code null} when blank. */
  public static String normalize(String code) {
    return code == null || code.isBlank() ? null : code.trim().toUpperCase(Locale.ROOT);
  }

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

    Set<String> valid = null;
    List<FSPStandardsType> regimes = standards.getNewFSPStandardsList().getFSPStandard();
    for (int r = 0; r < regimes.size(); r++) {
      FSPStandardsType regime = regimes.get(r);
      if (regime == null || regime.getStandardLayerList() == null) continue;
      List<StandardLayerListAssociationType> layerWrappers = regime.getStandardLayerList();
      for (int w = 0; w < layerWrappers.size(); w++) {
        StandardLayerListAssociationType layerWrapper = layerWrappers.get(w);
        if (layerWrapper == null || layerWrapper.getStandardLayer() == null) continue;
        List<StandardLayerType> layers = layerWrapper.getStandardLayer();
        for (int l = 0; l < layers.size(); l++) {
          StandardLayerType layer = layers.get(l);
          if (layer == null || layer.getStandardLayerSpeciesList() == null) continue;
          List<StandardLayerSpeciesListAssociationType> speciesWrappers =
              layer.getStandardLayerSpeciesList();
          for (int sw = 0; sw < speciesWrappers.size(); sw++) {
            StandardLayerSpeciesListAssociationType speciesWrapper = speciesWrappers.get(sw);
            if (speciesWrapper == null || speciesWrapper.getStandardLayerSpecies() == null) {
              continue;
            }
            List<StandardLayerSpeciesType> species = speciesWrapper.getStandardLayerSpecies();
            for (int s = 0; s < species.size(); s++) {
              StandardLayerSpeciesType sp = species.get(s);
              String code = sp == null ? null : normalize(sp.getSpeciesCode());
              if (code == null) continue;
              // Loaded lazily so submissions without species skip the lookup.
              if (valid == null) valid = loadValidCodes();
              if (valid.contains(code)) continue;
              errors.add(SubmissionValidationError.of(
                  "forestStewardshipPlan/stockingStandards/newFSPStandardsList/fSPStandard["
                      + r + "]/standardLayerList[" + w + "]/standardLayer[" + l
                      + "]/standardLayerSpeciesList[" + sw + "]/standardLayerSpecies[" + s
                      + "]/speciesCode",
                  "UNKNOWN_SPECIES_CODE",
                  "Species code \"" + sp.getSpeciesCode().trim() + "\" in stocking standard "
                      + describe(regime, r) + " is not a valid tree species code."
                      + suggestion(code, valid)));
            }
          }
        }
      }
    }
    return errors;
  }

  private Set<String> loadValidCodes() {
    return codeListsService.getSilvTreeSpeciesCodes().stream()
        .map(CodeOption::getCode)
        .map(SpeciesCodeValidator::normalize)
        .filter(c -> c != null)
        .collect(Collectors.toSet());
  }

  /** e.g. {@code FD} → " Did you mean FDC or FDI?" (codes split by variety). */
  private static String suggestion(String code, Set<String> valid) {
    Set<String> matches = valid.stream()
        .filter(c -> c.startsWith(code))
        .collect(Collectors.toCollection(TreeSet::new));
    return matches.isEmpty() || matches.size() > 5
        ? ""
        : " Did you mean " + String.join(" or ", matches) + "?";
  }

  private static String describe(FSPStandardsType regime, int index) {
    String name = regime.getStandardsRegimeName();
    return name == null || name.isBlank()
        ? "#" + (index + 1)
        : "\"" + name.trim() + "\"";
  }
}
