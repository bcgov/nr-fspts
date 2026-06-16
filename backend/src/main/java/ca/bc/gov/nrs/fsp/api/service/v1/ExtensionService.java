package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp302ExtensionRequestDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp303ExtensionSummaryDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionRequestSave;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionSummary;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
  private final Fsp302ExtensionRequestDao requestDao;

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

  /**
   * Create a new extension request via FSP_302_EXTENSION_REQUEST.SAVE.
   * Audit-user context is pulled from the JWT — userId is the
   * directory-prefixed form (IDIR\name / BCEID\name) so the audit
   * columns match the legacy convention.
   *
   * @return the proc-assigned extension id (and any error string).
   */
  @Transactional
  public Fsp302ExtensionRequestDao.SaveResult createRequest(
      String fspId, ExtensionRequestSave body) {
    Fsp302ExtensionRequestDao.SaveRequest req = new Fsp302ExtensionRequestDao.SaveRequest(
        fspId,
        null,                                            // extensionId = null → create
        body.getPlanTermYears(),
        body.getPlanTermMonths(),
        body.getFspExpiryDate(),
        body.getStatusComment(),
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles(),
        RequestUtil.getCurrentAuditUserId(),
        body.getRevisionCount());
    Fsp302ExtensionRequestDao.SaveResult result = requestDao.save(req);
    log.info("FSP_302 SAVE — fspId={} → new extensionId={}", fspId, result.extensionId());
    return result;
  }
}
