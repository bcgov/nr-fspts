package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.OrgUnitLookupDao;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Repository
public class OrgUnitLookupDaoImpl implements OrgUnitLookupDao {

  private final JdbcTemplate jdbc;
  // Cache code → no in-process; ORG_UNIT codes are stable reference data
  // and the lookup runs on every submission.
  private final Map<String, String> cache = new ConcurrentHashMap<>();

  public OrgUnitLookupDaoImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<String> findOrgUnitNoByCode(String orgUnitCode) {
    if (orgUnitCode == null || orgUnitCode.isBlank()) {
      return Optional.empty();
    }
    String cached = cache.get(orgUnitCode);
    if (cached != null) {
      return Optional.of(cached);
    }
    try {
      String orgUnitNo = jdbc.queryForObject(
          "SELECT org_unit_no FROM org_unit WHERE org_unit_code = ?",
          String.class,
          orgUnitCode);
      if (orgUnitNo != null) {
        cache.put(orgUnitCode, orgUnitNo);
      }
      return Optional.ofNullable(orgUnitNo);
    } catch (EmptyResultDataAccessException e) {
      return Optional.empty();
    }
  }

  @Override
  public List<Map<String, String>> findAllCodeNamePairs() {
    return jdbc.query(
        "SELECT org_unit_code, org_unit_name FROM org_unit "
            + "WHERE org_unit_code IS NOT NULL "
            + "ORDER BY org_unit_code",
        (rs, rowNum) -> {
          Map<String, String> row = new HashMap<>(2);
          row.put("code", rs.getString(1));
          row.put("description", rs.getString(2));
          return row;
        });
  }
}
