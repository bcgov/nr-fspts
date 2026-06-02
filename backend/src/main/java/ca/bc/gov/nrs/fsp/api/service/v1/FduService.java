package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp600MapDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.FduList;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Read wrapper for FSP_600_MAP.GET — surfaces the per-FDU rows the
 * FDU/Map screen needs. Audit-user context (client/role) is pulled
 * from the current JWT so the proc's access gate (delegated to
 * fsp_tombstone.get) sees the same identity as every other FSP_* DAO.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FduService {

  private final Fsp600MapDao dao;

  public FduList getFdus(String fspId) {
    Fsp600MapDao.Result r = dao.get(
        fspId,
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles());
    List<FduList.Fdu> fdus = r.fdus().stream()
        .map(f -> new FduList.Fdu(f.fduId(), f.fduName(), f.licences()))
        .toList();
    return new FduList(r.fduAmendmentNumber(), fdus);
  }
}
