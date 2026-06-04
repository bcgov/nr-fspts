package ca.bc.gov.nrs.fsp.api.submission.parser;

/** Thrown by {@link GmlGeometryConverter} when GML-to-JTS conversion fails. */
public class GmlConversionException extends Exception {
  public GmlConversionException(String message) {
    super(message);
  }
}
