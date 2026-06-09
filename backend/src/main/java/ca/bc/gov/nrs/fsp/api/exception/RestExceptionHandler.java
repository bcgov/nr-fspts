package ca.bc.gov.nrs.fsp.api.exception;

import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import ca.bc.gov.nrs.fsp.api.exception.errors.ApiError;
import java.util.Map;
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
    for (Map.Entry<String, ProcErrorMapping> entry : PROC_ERROR_MAP.entrySet()) {
      if (oracleMessage.contains(entry.getKey())) {
        ProcErrorMapping m = entry.getValue();
        ApiError apiError = new ApiError(m.status);
        apiError.setMessage(m.userMessage);
        log.warn("{}.{} → {}: {}",
            ex.getPackageName(), ex.getProcedureName(), entry.getKey(), m.userMessage);
        return buildResponseEntity(apiError);
      }
    }
    // Fall back to 500 + the raw Oracle message for unknown codes.
    log.error("Unhandled proc error from {}.{}: {}",
        ex.getPackageName(), ex.getProcedureName(), oracleMessage, ex);
    ApiError apiError = new ApiError(INTERNAL_SERVER_ERROR);
    apiError.setMessage(ex.getMessage());
    return buildResponseEntity(apiError);
  }

  private record ProcErrorMapping(
      org.springframework.http.HttpStatus status, String userMessage) {}

  /**
   * Curated list of legacy proc error codes that have a clean
   * user-facing equivalent. Substring match on the Oracle error message
   * so suffixes / package paths don't matter.
   */
  private static final Map<String, ProcErrorMapping> PROC_ERROR_MAP = Map.of(
      "FSP.INVALID.AGREEMENT.HOLDER", new ProcErrorMapping(FORBIDDEN,
          "Your client number is not on this FSP's agreement holder list, so "
              + "you can't modify it. An agreement holder for this FSP needs "
              + "to make the change."),
      "FSP.NO.AGREEMENT.HOLDER", new ProcErrorMapping(BAD_REQUEST,
          "FSP must have at least one agreement holder."),
      "FSP.BAD.ORG.UNIT", new ProcErrorMapping(BAD_REQUEST,
          "One of the supplied district codes isn't recognized."),
      "FSP.NO.NAME", new ProcErrorMapping(BAD_REQUEST,
          "Plan name is required."),
      "sil.web.error.usr.noRecord", new ProcErrorMapping(NOT_FOUND,
          "The requested record could not be found."),
      "sil.web.usr.database.record.modified", new ProcErrorMapping(CONFLICT,
          "This record was modified by someone else after you opened it. "
              + "Reload and try again."));

  // MaxUploadSizeExceededException, MultipartException, MissingServletRequest{Part,Parameter}Exception
  // are all already handled by the parent ResponseEntityExceptionHandler in
  // Spring 6+ — declaring local @ExceptionHandlers causes
  // "Ambiguous @ExceptionHandler method mapped" boot-time bean-init failures.
  // The parent returns ProblemDetail/ErrorResponse JSON bodies which are
  // sufficient for surfacing the cause to the client; if we ever need richer
  // payloads, override the protected handle*() methods on the parent rather
  // than re-declaring @ExceptionHandler annotations.

}
