package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.exception.ReportGenerationException;
import ca.bc.gov.nrs.fsp.api.exception.ReportNotFoundException;
import ca.bc.gov.nrs.fsp.api.service.v1.report.FspReportResult;
import ca.bc.gov.nrs.fsp.api.service.v1.report.FspReportService;
import ca.bc.gov.nrs.fsp.api.struct.v1.report.FspReportRequestDto;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Mirrors nr-rept's ReptReportController. POST a request body, get the
 * rendered PDF back with a Content-Disposition: attachment header so
 * the browser file-saves rather than inlining. Errors map to
 * ProblemDetail responses with appropriate status codes.
 *
 * <p>Lives at {@code /api/v1/fsp/reports} so it sits alongside the
 * other FSP-namespaced endpoints rather than pulling in a separate
 * {@code /api/reports} root.</p>
 */
@RestController
@RequestMapping("/api/v1/fsp/reports")
@Validated
public class FspReportController {

  private final FspReportService reportService;

  public FspReportController(FspReportService reportService) {
    this.reportService = reportService;
  }

  @PostMapping("/{reportId}")
  public ResponseEntity<byte[]> generateReport(
      @PathVariable("reportId") String reportId,
      @Valid @RequestBody FspReportRequestDto request
  ) {
    FspReportResult result = reportService.generateReport(reportId, request);
    ContentDisposition disposition = ContentDisposition
        .attachment()
        .filename(result.filename(), StandardCharsets.UTF_8)
        .build();
    return ResponseEntity
        .ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
        .contentType(result.mediaType())
        .body(result.content());
  }

  @ExceptionHandler(ReportNotFoundException.class)
  public ResponseEntity<ProblemDetail> handleNotFound(ReportNotFoundException exception) {
    ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, exception.getMessage());
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(detail);
  }

  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<ProblemDetail> handleBadRequest(IllegalArgumentException exception) {
    ProblemDetail detail = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, exception.getMessage());
    return ResponseEntity.badRequest().body(detail);
  }

  @ExceptionHandler(ReportGenerationException.class)
  public ResponseEntity<ProblemDetail> handleReportFailure(ReportGenerationException exception) {
    ProblemDetail detail = ProblemDetail.forStatusAndDetail(
        HttpStatus.BAD_GATEWAY, exception.getMessage());
    return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(detail);
  }
}
