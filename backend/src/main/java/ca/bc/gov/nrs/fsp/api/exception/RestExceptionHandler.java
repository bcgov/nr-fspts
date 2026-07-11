package ca.bc.gov.nrs.fsp.api.exception;

import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import ca.bc.gov.nrs.fsp.api.exception.errors.ApiError;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import static org.springframework.http.HttpStatus.*;

/**
 * The type Rest exception handler.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@ControllerAdvice
public class RestExceptionHandler extends ResponseEntityExceptionHandler {

  /**
   * The constant log.
   */
  private static final Logger log = LoggerFactory.getLogger(RestExceptionHandler.class);

  /**
   * Friendly fallback returned to the client whenever the real cause is
   * technical (raw Oracle/SQL text, a stack trace, an unmapped proc code).
   * The specifics are logged server-side; the UI only ever sees this.
   */
  private static final String GENERIC_ERROR_MESSAGE =
      "An unexpected error occurred. Please try again later.";

  /**
   * Handle http message not readable response entity.
   *
   * @param ex      the ex
   * @param headers the headers
   * @param status  the status
   * @param request the request
   * @return the response entity
   */
  @Override
  protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
    String error = "Malformed JSON request";
    log.error("{} ", error, ex);
    return buildResponseEntity(new ApiError(BAD_REQUEST, error, ex));
  }

  /**
   * Build response entity response entity.
   *
   * @param apiError the api error
   * @return the response entity
   */
  private ResponseEntity<Object> buildResponseEntity(ApiError apiError) {
    return new ResponseEntity<>(apiError, apiError.getStatus());
  }

  /**
   * Handles EntityNotFoundException. Created to encapsulate errors with more detail than jakarta.persistence.EntityNotFoundException.
   *
   * @param ex the EntityNotFoundException
   * @return the ApiError object
   */
  @ExceptionHandler(EntityNotFoundException.class)
  protected ResponseEntity<Object> handleEntityNotFound(
      EntityNotFoundException ex) {
    ApiError apiError = new ApiError(NOT_FOUND);
    apiError.setMessage(ex.getMessage());
    log.info("{} ", apiError.getMessage(), ex);
    return buildResponseEntity(apiError);
  }

  /**
   * Handles IllegalArgumentException
   *
   * @param ex the InvalidParameterException
   * @return the ApiError object
   */
  @ExceptionHandler(IllegalArgumentException.class)
  protected ResponseEntity<Object> handleInvalidParameter(IllegalArgumentException ex) {
    ApiError apiError = new ApiError(BAD_REQUEST);
    apiError.setMessage(ex.getMessage());
    log.error("{} ", apiError.getMessage(), ex);
    return buildResponseEntity(apiError);
  }

  /**
   * Handles IllegalArgumentException
   *
   * @param ex the InvalidParameterException
   * @return the ApiError object
   */
  @ExceptionHandler(PreConditionFailedException.class)
  protected ResponseEntity<Object> handlePreConditionFailed(PreConditionFailedException ex) {
    ApiError apiError = new ApiError(PRECONDITION_FAILED);
    apiError.setMessage(ex.getMessage());
    log.error("{} ", apiError.getMessage(), ex);
    return buildResponseEntity(apiError);
  }

  /**
   * Handles ConflictFoundException
   *
   * @param ex the ConflictFoundException
   * @return the ApiError object
   */
  @ExceptionHandler(ConflictFoundException.class)
  protected ResponseEntity<Object> handleConflictFound(ConflictFoundException ex) {
    ApiError apiError = new ApiError(CONFLICT);
    apiError.setMessage(ex.getMessage());
    log.error("{} ", apiError.getMessage(), ex);
    return buildResponseEntity(apiError);
  }

  /**
   * Handles InvalidParameterException
   *
   * @param ex the InvalidParameterException
   * @return the ApiError object
   */
  @ExceptionHandler(InvalidParameterException.class)
  protected ResponseEntity<Object> handleInvalidParameter(InvalidParameterException ex) {
    ApiError apiError = new ApiError(BAD_REQUEST);
    apiError.setMessage(ex.getMessage());
    log.error("{} ", apiError.getMessage(), ex);
    return buildResponseEntity(apiError);
  }

  /**
   * Handles MethodArgumentNotValidException. Triggered when an object fails @Valid validation.
   *
   * @param ex      the MethodArgumentNotValidException that is thrown when @Valid validation fails
   * @param headers HttpHeaders
   * @param status  HttpStatus
   * @param request WebRequest
   * @return the ApiError object
   */
  @Override
  protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
    ApiError apiError = new ApiError(BAD_REQUEST);
    apiError.setMessage("Validation error");
    apiError.addValidationErrors(ex.getBindingResult().getFieldErrors());
    apiError.addValidationError(ex.getBindingResult().getGlobalErrors());
    log.error("{} ", apiError.getMessage(), ex);
    return buildResponseEntity(apiError);
  }

  /**
   * Handles EntityNotFoundException. Created to encapsulate errors with more detail than jakarta.persistence.EntityNotFoundException.
   *
   * @param ex the EntityNotFoundException
   * @return the ApiError object
   */
  @ExceptionHandler(InvalidPayloadException.class)
  protected ResponseEntity<Object> handleInvalidPayload(
      InvalidPayloadException ex) {
    log.error("", ex);
    return buildResponseEntity(ex.getError());
  }

  /**
   * Handles VirusDetectedException — a throw-style upload rejection from
   * the virus scanner (infected file, or scanner unavailable under a
   * fail-closed policy). Maps to 422 (UNPROCESSABLE_ENTITY) with the
   * rejection's user-facing message as the body.
   */
  @ExceptionHandler(VirusDetectedException.class)
  protected ResponseEntity<Object> handleVirusDetected(VirusDetectedException ex) {
    ApiError apiError = new ApiError(UNPROCESSABLE_ENTITY);
    apiError.setMessage(ex.getMessage());
    log.warn("Upload rejected by virus scanner ({}): {}",
        ex.getRejection().code(), ex.getMessage());
    return buildResponseEntity(apiError);
  }

  /**
   * Map well-known legacy proc error codes (the {@code sil.web.error.*}
   * / {@code FSP.*} strings the procs put in {@code P_ERROR_MESSAGE})
   * to friendly HTTP responses. Unknown proc errors still surface as
   * 500s so we notice them in logs and can add a mapping later.
   */
  @ExceptionHandler(StoredProcedureException.class)
  protected ResponseEntity<Object> handleStoredProcedureError(StoredProcedureException ex) {
    String oracleMessage = ex.getOracleErrorMessage() == null
        ? ""
        : ex.getOracleErrorMessage();
    String code = ProcErrorMessages.firstMatchedCode(oracleMessage);
    if (code != null) {
      ProcErrorMessages.Info info = ProcErrorMessages.infoFor(code);
      ApiError apiError = new ApiError(info.status());
      apiError.setMessage(info.message());
      log.warn("{}.{} → {}: {}",
          ex.getPackageName(), ex.getProcedureName(), code, info.message());
      return buildResponseEntity(apiError);
    }
    // Unknown code: log the raw Oracle message for diagnosis but never
    // return it to the client — a generic 500 keeps ORA-…/SQL/stack text
    // out of the UI.
    log.error("Unhandled proc error from {}.{}: {}",
        ex.getPackageName(), ex.getProcedureName(), oracleMessage, ex);
    ApiError apiError = new ApiError(INTERNAL_SERVER_ERROR);
    apiError.setMessage(GENERIC_ERROR_MESSAGE);
    return buildResponseEntity(apiError);
  }

  /**
   * Catch-all for any Spring data-access failure that isn't wrapped as a
   * StoredProcedureException — e.g. a DataIntegrityViolationException from
   * ORA-01438 (value larger than column precision) raised straight out of
   * JdbcTemplate. Without this, Spring's default handler leaks the raw
   * Oracle/SQL text to the client. We log the full cause and return a
   * generic 500.
   */
  @ExceptionHandler(org.springframework.dao.DataAccessException.class)
  protected ResponseEntity<Object> handleDataAccessError(
      org.springframework.dao.DataAccessException ex) {
    log.error("Database access error", ex);
    ApiError apiError = new ApiError(INTERNAL_SERVER_ERROR);
    apiError.setMessage(GENERIC_ERROR_MESSAGE);
    return buildResponseEntity(apiError);
  }

  // Curated proc-code mappings live in ProcErrorMessages — single
  // source of truth shared with the Submit preflight (which reads the
  // codes back from fsp_error.get_error_keys and needs the same human
  // messages).

  // MaxUploadSizeExceededException, MultipartException, MissingServletRequest{Part,Parameter}Exception
  // are all already handled by the parent ResponseEntityExceptionHandler in
  // Spring 6+ — declaring local @ExceptionHandlers causes
  // "Ambiguous @ExceptionHandler method mapped" boot-time bean-init failures.
  // The parent returns ProblemDetail/ErrorResponse JSON bodies which are
  // sufficient for surfacing the cause to the client; if we ever need richer
  // payloads, override the protected handle*() methods on the parent rather
  // than re-declaring @ExceptionHandler annotations.

}
