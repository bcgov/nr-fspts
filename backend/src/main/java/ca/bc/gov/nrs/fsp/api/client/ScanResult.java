package ca.bc.gov.nrs.fsp.api.client;

/**
 * Outcome of a single clamd {@code INSTREAM} scan.
 *
 * @param status    CLEAN, INFECTED, or ERROR (scan could not complete)
 * @param signature the detected virus signature — populated only when
 *                  {@link Status#INFECTED}
 * @param detail    the raw clamd reply / error text for logging + debugging
 */
public record ScanResult(Status status, String signature, String detail) {

  /** Terminal states of a clamd scan. */
  public enum Status {
    /** clamd reported {@code OK}. */
    CLEAN,
    /** clamd reported {@code FOUND}. */
    INFECTED,
    /** clamd errored, timed out, or was unreachable — verdict unknown. */
    ERROR
  }

  public static ScanResult clean() {
    return new ScanResult(Status.CLEAN, null, "OK");
  }

  public static ScanResult infected(String signature, String detail) {
    return new ScanResult(Status.INFECTED, signature, detail);
  }

  public static ScanResult error(String detail) {
    return new ScanResult(Status.ERROR, null, detail);
  }

  public boolean isClean() {
    return status == Status.CLEAN;
  }

  public boolean isInfected() {
    return status == Status.INFECTED;
  }

  public boolean isError() {
    return status == Status.ERROR;
  }
}
