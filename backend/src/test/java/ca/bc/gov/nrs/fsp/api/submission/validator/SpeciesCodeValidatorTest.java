package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.service.v1.CodeListsService;
import ca.bc.gov.nrs.fsp.api.struct.v1.CodeOption;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPStandardsType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerListAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerSpeciesListAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerSpeciesType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardLayerType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.StandardsAssociationType;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link SpeciesCodeValidator}. An unknown species code violates
 * {@code SRLS_STSC_FK} and surfaced as a raw {@code ORA-02291} from
 * {@code FSP_550_SUB_SPECIES} at persist time.
 */
class SpeciesCodeValidatorTest {

  private final CodeListsService codeLists = Mockito.mock(CodeListsService.class);
  private final SpeciesCodeValidator validator = new SpeciesCodeValidator(codeLists);

  SpeciesCodeValidatorTest() {
    Mockito.when(codeLists.getSilvTreeSpeciesCodes()).thenReturn(List.of(
        new CodeOption("BL", "subalpine fir"),
        new CodeOption("SX", "hybrid spruce"),
        new CodeOption("FDC", "coastal Douglas-fir"),
        new CodeOption("FDI", "interior Douglas-fir")));
  }

  @Test
  void mixedCaseKnownCodes_areAccepted() {
    assertThat(validator.validate(submission(regime("Std A", "Bl", " sx ")))).isEmpty();
  }

  @Test
  void unknownCode_isRejected_withVarietySuggestion() {
    List<SubmissionValidationError> errors =
        validator.validate(submission(regime("Std A", "Bl"), regime("Std B", "Sx", "Fd")));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("UNKNOWN_SPECIES_CODE");
    assertThat(errors.get(0).message())
        .contains("\"Fd\"").contains("\"Std B\"").contains("Did you mean FDC or FDI?");
    assertThat(errors.get(0).path()).isEqualTo(
        "forestStewardshipPlan/stockingStandards/newFSPStandardsList/fSPStandard[1]"
            + "/standardLayerList[0]/standardLayer[0]/standardLayerSpeciesList[0]"
            + "/standardLayerSpecies[1]/speciesCode");
  }

  @Test
  void unknownCodeWithNoNearMatch_hasNoSuggestion() {
    List<SubmissionValidationError> errors =
        validator.validate(submission(regime("Std A", "Zz")));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).message()).doesNotContain("Did you mean");
  }

  @Test
  void noSpecies_skipsCodeListLookup() {
    assertThat(validator.validate(submission(regime("Std A")))).isEmpty();
    assertThat(validator.validate(null)).isEmpty();
    Mockito.verify(codeLists, Mockito.never()).getSilvTreeSpeciesCodes();
  }

  @Test
  void normalize_trimsAndUpperCases() {
    assertThat(SpeciesCodeValidator.normalize(" Bl ")).isEqualTo("BL");
    assertThat(SpeciesCodeValidator.normalize("  ")).isNull();
    assertThat(SpeciesCodeValidator.normalize(null)).isNull();
  }

  private static FSPStandardsType regime(String name, String... speciesCodes) {
    StandardLayerSpeciesListAssociationType speciesList =
        new StandardLayerSpeciesListAssociationType();
    for (String code : speciesCodes) {
      StandardLayerSpeciesType species = new StandardLayerSpeciesType();
      species.setSpeciesCode(code);
      speciesList.getStandardLayerSpecies().add(species);
    }
    StandardLayerType layer = new StandardLayerType();
    layer.getStandardLayerSpeciesList().add(speciesList);
    StandardLayerListAssociationType wrapper = new StandardLayerListAssociationType();
    wrapper.getStandardLayer().add(layer);
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
