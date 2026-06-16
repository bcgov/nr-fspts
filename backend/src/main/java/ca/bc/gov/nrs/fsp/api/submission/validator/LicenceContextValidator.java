package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.LicenceAssociationType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Walks every {@code <fdu>/<licenceList>/<licenceNumber>} in the
 * submission and checks each licence number against the provincial
 * {@code PROV_FOREST_USE} registry. Unknown licence numbers would
 * otherwise trip the {@code FDUL_PFU_FK} FK on the {@code FDU_LICENCE_XREF}
 * insert mid-pipeline (ORA-02291) — by then the FSP_300 header has
 * already been written, so the partial state is harder to reason about.
 *
 * <p>Distinct values are checked once per submission via a small
 * lookup-result cache so 100 FDUs sharing the same five licences don't
 * fan out into 100 SELECTs.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class LicenceContextValidator {

  private final FduWriteDao fduWriteDao;

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) {
      return errors;
    }
    FDUAssociationType fduList = plan.getFduList();
    if (fduList == null || fduList.getFdu() == null) {
      return errors;
    }

    // Per-submission cache: same licence appearing on multiple FDUs
    // only hits PROV_FOREST_USE once. Key is the normalised (trimmed,
    // upper-cased) licence id.
    Map<String, Boolean> seen = new HashMap<>();
    List<FDUType> fdus = fduList.getFdu();
    for (int i = 0; i < fdus.size(); i++) {
      FDUType fdu = fdus.get(i);
      LicenceAssociationType licenceList = fdu.getLicenceList();
      if (licenceList == null || licenceList.getLicenceNumber() == null) {
        continue;
      }
      List<String> licences = licenceList.getLicenceNumber();
      String fduLabel = fdu.getFduName() == null || fdu.getFduName().isBlank()
          ? "FDU #" + (i + 1)
          : fdu.getFduName();
      for (int j = 0; j < licences.size(); j++) {
        String raw = licences.get(j);
        if (raw == null || raw.isBlank()) continue;
        String normalised = raw.trim().toUpperCase();
        Boolean exists = seen.computeIfAbsent(
            normalised, fduWriteDao::licenceExists);
        if (!exists) {
          String path = "forestStewardshipPlan/fduList/fdu[" + i
              + "]/licenceList/licenceNumber[" + j + "]";
          errors.add(SubmissionValidationError.of(
              path,
              "LICENCE_NOT_FOUND",
              "Licence number \"" + raw.trim() + "\" on " + fduLabel
                  + " is not in the provincial forest-use registry."));
        }
      }
    }
    return errors;
  }
}
