package ca.bc.gov.nrs.fsp.api.dao.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.bean.LicenseeArrayElement;
import ca.bc.gov.nrs.fsp.api.dao.v1.bean.OrgUnitArrayElement;
import oracle.jdbc.OracleConnection;
import oracle.jdbc.OracleTypes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Common helpers for calling Oracle PL/SQL packages exactly as the legacy
 * adaptors did: positional CallableStatement parameters, REF CURSORs read
 * via cs.getObject(int), and ARRAY/STRUCT IN values built via
 * OracleConnection.createOracleArray / createOracleStruct.
 */
public abstract class AbstractStoredProcedureDao {

  private static final Logger log = LoggerFactory.getLogger(AbstractStoredProcedureDao.class);

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
        // Set fetch size on the statement BEFORE execute so it
        // propagates to any REF CURSOR OUT params at cursor-open time,
        // not just on subsequent fetches. Oracle JDBC otherwise uses
        // the connection-level defaultRowPrefetch (10) for the first
        // batch — meaning a 500-row search still pays for ~50 of those
        // round-trips before the per-ResultSet setFetchSize in
        // readCursor takes over. With it set here, even the first
        // batch is 500 wide; this is why inbox (small result set, fits
        // in one prefetch anyway) felt fast and search (larger set)
        // felt slow despite sharing the same readCursor path.
        cs.setFetchSize(CURSOR_FETCH_SIZE);
        setter.apply(cs);

        // Per-call timing breakdown so a slow proc shows whether the
        // cost is the server-side PL/SQL run (cs.execute) or draining
        // the cursor over the wire (extractor). When we see e.g.
        // exec=197s, extract=1s — it's plan/PL/SQL. When we see
        // exec=1s, extract=197s — it's network/fetch volume. Logged at
        // DEBUG so prod is silent; flip ca.bc.gov.nrs.fsp.api.dao to
        // DEBUG in application-local.properties to investigate.
        long t0 = System.nanoTime();
        cs.execute();
        long execNs = System.nanoTime() - t0;

        long t1 = System.nanoTime();
        T out = extractor.apply(cs);
        long extractNs = System.nanoTime() - t1;

        if (log.isDebugEnabled()) {
          log.debug("Proc {} timing: exec={} ms, extract={} ms",
              shortSql(sql),
              execNs / 1_000_000,
              extractNs / 1_000_000);
        } else if (execNs + extractNs > 5_000_000_000L) {
          // Warn at INFO when a single call crosses the 5-second mark
          // even without DEBUG logging — operationally that's the
          // signal that DBA-side investigation is warranted.
          log.warn("Slow proc {}: exec={} ms, extract={} ms",
              shortSql(sql),
              execNs / 1_000_000,
              extractNs / 1_000_000);
        }
        return out;
      }
    });
  }

  /** "{call PKG.PROC(?,...)}" → "PKG.PROC" for compact log output. */
  private static String shortSql(String sql) {
    int open = sql.indexOf('(');
    int call = sql.indexOf("call ");
    if (call >= 0 && open > call) return sql.substring(call + 5, open).trim();
    return sql;
  }

  /**
   * Raise on fatal proc errors; let warnings/info pass.
   *
   * <p>The legacy FSP/SIL packages encode severity in the error_message
   * trailer: {@code <code>:~E} for errors, {@code :~W} for warnings,
   * {@code :~I} for info. The web-tier's parseToErrorsWarnings() splits
   * on that suffix and only halts processing for {@code :~E} segments
   * — e.g. {@code FSP_400_ATTACHMENTS.GET} returns
   * {@code fsp.web.warning.fsp.noRecordsFound:~W} for an FSP with zero
   * rows, which the proc treats as a successful "empty result" not a
   * failure.</p>
   *
   * <p>Rules:
   * <ul>
   *   <li>blank or null → no-op</li>
   *   <li>contains {@code :~E} → fatal, throw</li>
   *   <li>contains only {@code :~W} / {@code :~I} → log + return</li>
   *   <li>no {@code :~} marker at all → assume legacy emitted a raw
   *       error string (some older procs do); throw for safety</li>
   * </ul>
   */
  protected void throwIfError(String packageName, String procedureName, @Nullable String pErrorMessage) {
    if (!StringUtils.hasText(pErrorMessage)) return;
    if (pErrorMessage.contains(":~E")) {
      throw new StoredProcedureException(packageName, procedureName, pErrorMessage);
    }
    if (pErrorMessage.contains(":~W") || pErrorMessage.contains(":~I")) {
      log.debug("Proc {}.{} returned non-fatal advisory: {}",
          packageName, procedureName, pErrorMessage);
      return;
    }
    throw new StoredProcedureException(packageName, procedureName, pErrorMessage);
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
    return readCursor(cs, index, reader, -1);
  }

  /**
   * Read an OUT REF CURSOR with an upper bound on rows. Pass {@code maxRows
   * <= 0} for unbounded drain (legacy behavior; safe for small cursors like
   * inbox or code-list lookups). Pass a positive value to stop iterating
   * after that many rows — the cursor is closed via try-with-resources, so
   * the unread tail is discarded server-side without us paying for it.
   *
   * The pattern callers use to detect "is there a next page": ask for
   * {@code requestedPageSize + 1} rows. If the returned list is exactly
   * that size, at least one more row exists in the cursor and the caller
   * knows hasNext=true; if shorter, the cursor was exhausted.
   *
   * This is the only practical knob we have for paginating procs that
   * return a REF CURSOR with no native ORDER BY / OFFSET / FETCH FIRST
   * (FSP_100_SEARCH.MAINLINE et al). Without it, search for a large org
   * unit drains tens of thousands of rows over VPN before the service
   * layer even sees the data.
   */
  protected <T> List<T> readCursor(CallableStatement cs, int index, CursorRowReader<T> reader, int maxRows) throws SQLException {
    List<T> out = maxRows > 0 ? new ArrayList<>(maxRows) : new ArrayList<>();
    Object obj = cs.getObject(index);
    if (!(obj instanceof ResultSet rs)) return out;
    try (ResultSet auto = rs) {
      auto.setFetchSize(CURSOR_FETCH_SIZE);
      while (auto.next()) {
        out.add(reader.read(auto));
        if (maxRows > 0 && out.size() >= maxRows) break;
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
