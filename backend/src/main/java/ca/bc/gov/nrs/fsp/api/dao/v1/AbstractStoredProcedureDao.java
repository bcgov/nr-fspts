package ca.bc.gov.nrs.fsp.api.dao.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.bean.LicenseeArrayElement;
import ca.bc.gov.nrs.fsp.api.dao.v1.bean.OrgUnitArrayElement;
import oracle.jdbc.OracleConnection;
import oracle.jdbc.OracleTypes;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;

import java.sql.Array;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Struct;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;

/**
 * Common helpers for calling Oracle PL/SQL packages exactly as the legacy
 * adaptors did: positional CallableStatement parameters, REF CURSORs read
 * via cs.getObject(int), and ARRAY/STRUCT IN values built via
 * OracleConnection.createOracleArray / createOracleStruct.
 */
public abstract class AbstractStoredProcedureDao {

  public static final String SCHEMA = "THE";
  public static final String ORG_UNIT_VARRAY_TYPE = SCHEMA + ".FSP_ORG_UNIT_VARRAY";
  public static final String ORG_UNIT_OBJECT_TYPE = SCHEMA + ".FSP_ORG_UNIT_OBJECT";
  public static final String LICENSEE_VARRAY_TYPE = SCHEMA + ".FSP_300_LICENSEE_VARRAY";
  public static final String LICENSEE_OBJECT_TYPE = SCHEMA + ".FSP_300_LICENSEE_OBJECT";

  protected final JdbcTemplate jdbcTemplate;

  protected AbstractStoredProcedureDao(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @FunctionalInterface
  protected interface CallStatementSetter {
    void apply(CallableStatement cs) throws SQLException;
  }

  @FunctionalInterface
  protected interface CallResultExtractor<T> {
    T apply(CallableStatement cs) throws SQLException;
  }

  protected <T> T executeCall(String sql, CallStatementSetter setter, CallResultExtractor<T> extractor) {
    return jdbcTemplate.execute((ConnectionCallback<T>) conn -> {
      try (CallableStatement cs = conn.prepareCall(sql)) {
        setter.apply(cs);
        cs.execute();
        return extractor.apply(cs);
      }
    });
  }

  /** Throw if Oracle returned an error message. */
  protected void throwIfError(String packageName, String procedureName, @Nullable String pErrorMessage) {
    if (StringUtils.hasText(pErrorMessage)) {
      throw new StoredProcedureException(packageName, procedureName, pErrorMessage);
    }
  }

  /** Set an INOUT VARCHAR by index. */
  protected void setInOutString(CallableStatement cs, int index, @Nullable String value) throws SQLException {
    if (value == null) {
      cs.setNull(index, Types.VARCHAR);
    } else {
      cs.setString(index, value);
    }
    cs.registerOutParameter(index, Types.VARCHAR);
  }

  /** Register an OUT REF CURSOR by index. */
  protected void registerOutCursor(CallableStatement cs, int index) throws SQLException {
    cs.registerOutParameter(index, OracleTypes.CURSOR);
  }

  /** Set an INOUT ARRAY by index, registering the OUT side with the given Oracle type. */
  protected void setInOutOrgUnits(CallableStatement cs, int index, @Nullable List<OrgUnitArrayElement> elements) throws SQLException {
    if (elements == null) {
      cs.setNull(index, Types.ARRAY, ORG_UNIT_VARRAY_TYPE);
    } else {
      OracleConnection oc = cs.getConnection().unwrap(OracleConnection.class);
      Object[] structs = new Object[elements.size()];
      for (int i = 0; i < elements.size(); i++) {
        OrgUnitArrayElement e = elements.get(i);
        structs[i] = oc.createStruct(ORG_UNIT_OBJECT_TYPE,
            new Object[] { e.orgUnitNo(), e.orgUnitCode(), e.orgUnitName() });
      }
      Array arr = oc.createOracleArray(ORG_UNIT_VARRAY_TYPE, structs);
      cs.setArray(index, arr);
    }
    cs.registerOutParameter(index, Types.ARRAY, ORG_UNIT_VARRAY_TYPE);
  }

  protected void setInOutLicensees(CallableStatement cs, int index, @Nullable List<LicenseeArrayElement> elements) throws SQLException {
    if (elements == null) {
      cs.setNull(index, Types.ARRAY, LICENSEE_VARRAY_TYPE);
    } else {
      OracleConnection oc = cs.getConnection().unwrap(OracleConnection.class);
      Object[] structs = new Object[elements.size()];
      for (int i = 0; i < elements.size(); i++) {
        LicenseeArrayElement e = elements.get(i);
        structs[i] = oc.createStruct(LICENSEE_OBJECT_TYPE,
            new Object[] { e.clientNumber(), e.clientName(), e.agreementDescription() });
      }
      Array arr = oc.createOracleArray(LICENSEE_VARRAY_TYPE, structs);
      cs.setArray(index, arr);
    }
    cs.registerOutParameter(index, Types.ARRAY, LICENSEE_VARRAY_TYPE);
  }

  /** Read an OUT ARRAY of THE.FSP_ORG_UNIT_OBJECT into a Java list, mirroring the legacy adaptor. */
  protected List<OrgUnitArrayElement> readOrgUnits(CallableStatement cs, int index) throws SQLException {
    Array arr = cs.getArray(index);
    if (arr == null) return List.of();
    Object raw = arr.getArray();
    if (!(raw instanceof Object[] elements)) return List.of();
    List<OrgUnitArrayElement> out = new ArrayList<>(elements.length);
    for (Object element : elements) {
      Struct s = (Struct) element;
      Object[] attrs = s.getAttributes();
      out.add(new OrgUnitArrayElement(
          attrs[0] == null ? "" : attrs[0].toString(),
          attrs[1] == null ? "" : attrs[1].toString(),
          attrs[2] == null ? "" : attrs[2].toString()));
    }
    return out;
  }

  protected List<LicenseeArrayElement> readLicensees(CallableStatement cs, int index) throws SQLException {
    Array arr = cs.getArray(index);
    if (arr == null) return List.of();
    Object raw = arr.getArray();
    if (!(raw instanceof Object[] elements)) return List.of();
    List<LicenseeArrayElement> out = new ArrayList<>(elements.length);
    for (Object element : elements) {
      Struct s = (Struct) element;
      Object[] attrs = s.getAttributes();
      out.add(new LicenseeArrayElement(
          attrs[0] == null ? "" : attrs[0].toString(),
          attrs[1] == null ? "" : attrs[1].toString(),
          attrs[2] == null ? "" : attrs[2].toString()));
    }
    return out;
  }

  /**
   * Oracle JDBC's default cursor fetch size is 10 rows per round-trip
   * (oracle.jdbc.defaultRowPrefetch). On a low-latency in-cluster
   * connection that's invisible; from a developer laptop over VPN
   * (~300 ms RTT to the BCGov Oracle) a 1000-row SIL21 client search
   * needs 100 round-trips and takes 30+ seconds. Bump to 500 so a
   * typical search comes back in 1-2 round-trips.
   *
   * Memory cost is bounded — 500 rows × ~200 bytes/row ≈ 100 KB per
   * fetch. Safe for any FSP/SIL cursor we read.
   */
  private static final int CURSOR_FETCH_SIZE = 500;

  /** Read an OUT REF CURSOR via cs.getObject(index) into a list using a per-row reader. */
  protected <T> List<T> readCursor(CallableStatement cs, int index, CursorRowReader<T> reader) throws SQLException {
    List<T> out = new ArrayList<>();
    Object obj = cs.getObject(index);
    if (!(obj instanceof ResultSet rs)) return out;
    try (ResultSet auto = rs) {
      auto.setFetchSize(CURSOR_FETCH_SIZE);
      while (auto.next()) {
        out.add(reader.read(auto));
      }
    }
    return out;
  }

  @FunctionalInterface
  protected interface CursorRowReader<T> {
    T read(ResultSet rs) throws SQLException;
  }

  /** Question-mark placeholder string for a positional callable statement. */
  protected static String placeholders(int n) {
    StringBuilder sb = new StringBuilder(2 * n);
    for (int i = 0; i < n; i++) {
      if (i > 0) sb.append(',');
      sb.append('?');
    }
    return sb.toString();
  }

  /** Build "{call <pkg>.<proc>(?,?,...,?)}" with `n` placeholders. */
  protected static String callSql(String packageName, String procedureName, int paramCount) {
    return "{call " + packageName + "." + procedureName + "(" + placeholders(paramCount) + ")}";
  }

  protected static String emptyIfNull(@Nullable String s) {
    return s == null ? "" : s;
  }
}
