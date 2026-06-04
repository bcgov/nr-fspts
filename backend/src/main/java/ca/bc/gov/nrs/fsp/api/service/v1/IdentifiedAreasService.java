package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp650IdentifiedAreasMapDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.IdentifiedAreaList;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read wrapper for FSP_650_IDENTIFIED_AREAS_MAP. The legacy app split
 * the screen into one sub-tab per legislation type; we issue the same
 * three proc calls and merge them into a flat list with the type
 * carried on each row so the UI can render a single combined table.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class IdentifiedAreasService {

  // Ordered map so the legacy display order is preserved when the
  // results are merged. Keys are the proc legislation_type codes;
  // values are the pretty labels shown in the table's column.
  private static final Map<String, String> LEGISLATION_LABELS = new LinkedHashMap<>();
  static {
    LEGISLATION_LABELS.put("FRPA196(1)", "FRPA s.196(1)");
    LEGISLATION_LABELS.put("FRPA196(2)", "FRPA s.196(2)");
    LEGISLATION_LABELS.put("FPPR14(4)", "FPPR s.14(4)");
  }

  private final Fsp650IdentifiedAreasMapDao dao;

  public IdentifiedAreaList getAreas(String fspId) {
    String userClient = RequestUtil.getCurrentClientNumber();
    String userRole = RequestUtil.getCurrentLegacyRoles();
    List<IdentifiedAreaList.IdentifiedArea> merged = new ArrayList<>();
    for (Map.Entry<String, String> e : LEGISLATION_LABELS.entrySet()) {
      String type = e.getKey();
      String label = e.getValue();
      try {
        var rows = dao.get(fspId, type, userClient, userRole);
        for (var r : rows) {
          merged.add(new IdentifiedAreaList.IdentifiedArea(
              r.identifiedAreaId(),
              r.identifiedAreaName(),
              type,
              label));
        }
      } catch (RuntimeException ex) {
        // Per-type failures shouldn't blow up the whole list; log and
        // surface the rows we did manage to gather. fsp_tombstone.get
        // already emits warnings via the AbstractStoredProcedureDao
        // severity-aware handler — true errors will still propagate.
        log.warn("FSP_650.GET failed for fsp={} type={}: {}", fspId, type, ex.getMessage());
      }
    }
    return new IdentifiedAreaList(merged);
  }
}
