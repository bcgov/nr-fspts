package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp303ExtensionSummaryDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionSummary;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Read wrapper for FSP_303_EXTENSION_SUMMARY.GET_LIST. Audit-user
 * context (client, role, userid) is pulled from the current JWT via
 * {@link RequestUtil} so this service shares the exact same
 * FAM-cognito → legacy-proc translation as FspService.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ExtensionService {

  private final Fsp303ExtensionSummaryDao dao;

  public ExtensionSummary getSummary(String fspId) {
    Fsp303ExtensionSummaryDao.Result r = dao.getList(
        fspId,
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles(),
        RequestUtil.getCurrentIdir());
    List<ExtensionSummary.Extension> extensions = r.extensions().stream()
        .map(e -> new ExtensionSummary.Extension(
            e.extensionId(),
            e.extensionNumber(),
            e.statusCode(),
            e.statusDescription(),
            e.planTermYears(),
            e.planTermMonths(),
            e.planStartDate(),
            e.planEndDate(),
            e.submissionDate(),
            e.decisionDate(),
            e.approvalDate(),
            e.rejectDate(),
            e.fspAmendmentNumber(),
            e.statusComment()))
        .toList();
    return new ExtensionSummary(
        r.fspId(),
        r.fspPlanName(),
        r.originalEffectiveDate(),
        r.originalExpiryDate(),
        r.currentPlanTermYears(),
        r.currentPlanTermMonths(),
        r.currentExpiryDate(),
        extensions);
  }
}
