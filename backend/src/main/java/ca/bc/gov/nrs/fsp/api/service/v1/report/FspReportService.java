package ca.bc.gov.nrs.fsp.api.service.v1.report;

import ca.bc.gov.nrs.fsp.api.exception.ReportGenerationException;
import ca.bc.gov.nrs.fsp.api.exception.ReportNotFoundException;
import ca.bc.gov.nrs.fsp.api.struct.v1.report.FspReportFormat;
import ca.bc.gov.nrs.fsp.api.struct.v1.report.FspReportRequestDto;
import jakarta.annotation.PostConstruct;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.sql.DataSource;
import net.sf.jasperreports.engine.JRException;
import net.sf.jasperreports.engine.JasperCompileManager;
import net.sf.jasperreports.engine.JasperExportManager;
import net.sf.jasperreports.engine.JasperFillManager;
import net.sf.jasperreports.engine.JasperPrint;
import net.sf.jasperreports.engine.JasperReport;
import net.sf.jasperreports.engine.export.JRCsvExporter;
import net.sf.jasperreports.export.SimpleExporterInput;
import net.sf.jasperreports.export.SimpleWriterExporterOutput;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

/**
 * Compile-on-first-request JasperReports engine. Mirrors
 * nr-rept's ReptReportService — same caching strategy, same exception
 * mapping (NotFound / GenerationException), same PDF-only output for
 * now (CSV is wired into FspReportFormat but JasperExportManager
 * doesn't export CSV directly; if/when we need it, add a JRCsvExporter
 * branch here).
 *
 * <p>JRXML templates live under {@code classpath:reports/<NAME>.jrxml}
 * where {@code NAME} matches {@code FspReportDefinition.name()}.</p>
 */
@Service
public class FspReportService {

  private static final Logger LOG = LoggerFactory.getLogger(FspReportService.class);

  private final DataSource dataSource;
  private final FspReportParameterProvider parameterProvider;
  private final ConcurrentHashMap<String, JasperReport> compiledCache = new ConcurrentHashMap<>();

  public FspReportService(DataSource dataSource, FspReportParameterProvider parameterProvider) {
    this.dataSource = dataSource;
    this.parameterProvider = parameterProvider;
  }

  /**
   * Pre-compile every JRXML referenced by {@link FspReportDefinition} at
   * startup so broken templates surface in deploy logs instead of
   * waiting for the first user hit. nr-rept compiles purely on demand;
   * we run both — the warm-up populates the same cache the on-demand
   * path reads, so a request after startup is still served from cache.
   *
   * <p>Failures are logged but do NOT abort the boot: one bad template
   * shouldn't take the whole API offline. On-demand callers will hit
   * the same compile failure later and receive a 502 with the JR error.
   * Legacy FSP JRXMLs reference {@code com.jaspersoft.jasperserver.api.*}
   * classes that only exist when running inside JRS — those need
   * scrubbing before the templates compile embedded, but until then
   * they degrade gracefully here.</p>
   */
  @PostConstruct
  void warmCompileCache() {
    for (FspReportDefinition definition : FspReportDefinition.values()) {
      try {
        compiledCache.put(definition.getId(), compileTemplate(definition));
        LOG.info("Pre-compiled report template [{}]", definition.getId());
      } catch (ReportNotFoundException ex) {
        LOG.warn("Report [{}] has no JRXML on the classpath; will 404 at request time",
            definition.getId());
      } catch (ReportGenerationException ex) {
        LOG.warn("Report [{}] failed to compile at startup; will 502 at request time: {}",
            definition.getId(), ex.getMessage());
      }
    }
  }

  public FspReportResult generateReport(String reportId, FspReportRequestDto request) {
    FspReportDefinition definition = FspReportDefinition.fromId(reportId);
    FspReportFormat format = FspReportFormat.fromNullable(request.format());

    Map<String, Object> params = parameterProvider.buildJasperParameters(definition, request);
    JasperReport jasperReport = compiledCache.computeIfAbsent(
        definition.getId(), id -> compileTemplate(definition));

    try (Connection connection = dataSource.getConnection()) {
      JasperPrint print = JasperFillManager.fillReport(jasperReport, params, connection);
      byte[] body = switch (format) {
        case PDF -> JasperExportManager.exportReportToPdf(print);
        case CSV -> exportToCsv(print);
      };
      if (body == null || body.length == 0) {
        throw new ReportGenerationException(
            "Empty " + format.name() + " produced for report " + reportId);
      }
      return new FspReportResult(body, definition.resolveFilename(format), format.getMediaType());
    } catch (JRException ex) {
      LOG.error("Jasper fill/export failed for [{}]", reportId, ex);
      throw new ReportGenerationException("Failed to render report " + reportId, ex);
    } catch (SQLException ex) {
      LOG.error("Database connection failed for report [{}]", reportId, ex);
      throw new ReportGenerationException("Database connection failed for report " + reportId, ex);
    }
  }

  /**
   * Exports the filled report to CSV via JRCsvExporter. JR writes
   * character data, so we wrap the byte stream in a UTF-8
   * {@link SimpleWriterExporterOutput}. The CSV produced is a flat
   * tabular dump of the report's main dataset — band layout, images,
   * subreport callouts etc. are silently dropped, which is the
   * expected behaviour for the CSV variant.
   */
  private static byte[] exportToCsv(JasperPrint print) throws JRException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    JRCsvExporter exporter = new JRCsvExporter();
    exporter.setExporterInput(new SimpleExporterInput(print));
    exporter.setExporterOutput(
        new SimpleWriterExporterOutput(out, StandardCharsets.UTF_8.name()));
    exporter.exportReport();
    return out.toByteArray();
  }

  private JasperReport compileTemplate(FspReportDefinition definition) {
    String path = "reports/" + definition.name() + ".jrxml";
    ClassPathResource resource = new ClassPathResource(path);
    if (!resource.exists()) {
      throw new ReportNotFoundException(definition.getId(),
          new IllegalStateException("No JRXML template at classpath:" + path));
    }
    try (InputStream is = resource.getInputStream()) {
      return JasperCompileManager.compileReport(is);
    } catch (JRException | IOException ex) {
      LOG.error("Failed to compile JRXML for [{}] (path={})", definition.getId(), path, ex);
      throw new ReportGenerationException("Failed to compile JRXML for " + definition.getId(), ex);
    }
  }
}
