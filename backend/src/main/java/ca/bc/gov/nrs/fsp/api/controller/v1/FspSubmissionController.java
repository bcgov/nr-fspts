package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.constants.v1.URL;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationResult;
import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationService;
import ca.bc.gov.nrs.fsp.api.submission.persist.SubmissionPersistenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Phase-1 FSP XML submission endpoint. Replaces the legacy ESF queue
 * intake with a direct multipart upload + validation cycle. This
 * controller is read-only: it parses and validates the uploaded XML
 * but does not persist anything. Persistence + workflow side effects
 * land in subsequent phases.
 *
 * <p>Returns 200 with {@code valid: true} when the submission passes
 * schema and geometry checks, or 422 with the collected errors when
 * it does not.
 */
@RestController
@RequestMapping(URL.BASE_URL)
@RequiredArgsConstructor
@Tag(name = "FSP Submissions", description = "FSP XML submission intake")
@Slf4j
public class FspSubmissionController {

  private final SubmissionValidationService validationService;
  private final SubmissionPersistenceService persistenceService;

  @PostMapping(value = URL.SUBMISSIONS_VALIDATE, consumes = "multipart/form-data")
  @Operation(summary = "Validate an FSP submission XML against schema + geometry rules")
  @ApiResponses({
      @ApiResponse(responseCode = "200", description = "Submission is valid"),
      @ApiResponse(
          responseCode = "422",
          description = "Submission failed schema or geometry validation"),
      @ApiResponse(responseCode = "400", description = "Missing or unreadable file"),
  })
  public ResponseEntity<SubmissionValidationResult> validate(
      @RequestParam(value = "file", required = false) MultipartFile file) throws IOException {
    log.info("validate: file part received name={} originalFilename={} size={}",
        file == null ? "<null>" : file.getName(),
        file == null ? "<null>" : file.getOriginalFilename(),
        file == null ? "<null>" : file.getSize());
    if (file == null || file.isEmpty()) {
      SubmissionValidationResult missing = SubmissionValidationResult.failed(
          List.of(SubmissionValidationError.of(
              "UPLOAD_MISSING",
              "file part missing or empty: name="
                  + (file == null ? "<null>" : file.getOriginalFilename())
                  + " size=" + (file == null ? "<null>" : file.getSize()))),
          null);
      return ResponseEntity.badRequest().body(missing);
    }
    byte[] xml = file.getBytes();
    SubmissionValidationResult result = validationService.validate(xml);
    HttpStatus status = result.valid() ? HttpStatus.OK : HttpStatus.UNPROCESSABLE_ENTITY;
    return ResponseEntity.status(status).body(result);
  }

  /**
   * Validate then persist an FSP submission.
   *
   * <p>Required {@code file} part is the FSP XML (either bare
   * {@code <fsp:fspSubmission>} or ESF-wrapped). Optional
   * {@code attachments} parts (zero or more) are stored as
   * FSP-level attachments under the new amendment, defaulting to
   * the "OTHR" (Supporting Documents) category.
   *
   * <p>Returns 201 + the saved FSP DTO on success, 422 + structured
   * errors when validation fails. All persistence runs in a single
   * transaction — any mid-pipeline failure rolls back the whole
   * submission.
   */
  @PostMapping(value = URL.SUBMISSIONS, consumes = "multipart/form-data")
  @Operation(summary = "Upload, validate, and persist an FSP submission XML with optional attachments")
  @ApiResponses({
      @ApiResponse(responseCode = "201", description = "Submission persisted"),
      @ApiResponse(
          responseCode = "422",
          description = "Submission failed schema or geometry validation"),
      @ApiResponse(responseCode = "400", description = "Missing or unreadable file"),
  })
  public ResponseEntity<?> submit(
      @RequestParam("file") MultipartFile file,
      @RequestParam(value = "attachments", required = false) List<MultipartFile> attachments)
      throws IOException {
    if (file == null || file.isEmpty()) {
      return ResponseEntity.badRequest().body(
          SubmissionValidationResult.failed(List.of(SubmissionValidationError.of(
              "UPLOAD_MISSING", "no file part named 'file' was provided")), null));
    }
    SubmissionValidationService.ValidationOutcome outcome =
        validationService.validateAndParse(file.getBytes());
    if (!outcome.result().valid()) {
      return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(outcome.result());
    }
    FspRequest saved = persistenceService.persist(outcome.submission(), attachments);
    return ResponseEntity.status(HttpStatus.CREATED).body(saved);
  }
}
