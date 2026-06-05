package ca.bc.gov.nrs.fsp.api.submission.geojson;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * Jackson-bound DTOs for the FSP GeoJSON submission format. Shape is
 * a standard {@code FeatureCollection} with two FSP-specific extras:
 *
 * <ul>
 *   <li>A {@code fsp} foreign member on the FeatureCollection itself
 *       carrying plan-level header fields that have no place inside a
 *       per-feature {@code properties} map.</li>
 *   <li>A {@code fspEntityType} discriminator on each Feature's
 *       {@code properties} (currently {@code FDU} or {@code IDENTIFIED_AREA})
 *       so the parser can route polygons to the right collection.</li>
 * </ul>
 *
 * <p>All records are unknown-field-tolerant so a hand-edited file with
 * stray keys won't fail parse; we only read what we recognize.
 */
public final class FspGeoJson {

  private FspGeoJson() {}

  /** Root FSP GeoJSON submission document. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record FspGeoJsonSubmission(
      String type,
      Crs crs,
      Header fsp,
      List<Feature> features
  ) {}

  /** Legacy GeoJSON named CRS — {@code {"type":"name","properties":{"name":"EPSG:3005"}}}. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Crs(String type, Map<String, String> properties) {
    /** Returns the SRS name (e.g. "EPSG:3005") or null if the structure isn't there. */
    public String srsName() {
      return properties == null ? null : properties.get("name");
    }
  }

  /** FSP plan-level header carried as a foreign member on the FeatureCollection. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Header(
      String fspId,
      String planName,
      /** Submission intent: {@code I} initial, {@code U} update-draft, {@code A} amendment. */
      String actionCode,
      String amendmentName,
      String amendmentComment,
      Boolean amendmentApprovalRequired,
      Metadata submissionMetadata,
      List<String> planHolders,
      List<String> districts,
      Integer planTermYears,
      Integer planTermMonths,
      Boolean frpa197,
      Boolean transitional,
      Boolean legalDocConsolidated,
      Boolean fduUpdate,
      Boolean identifiedAreasUpdate,
      Boolean stockingStandardsUpdate
  ) {}

  /** Envelope-level contact info (mirrors the XML's fspSubmissionMetadata). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Metadata(
      String contactName,
      String telephoneNumber,
      String emailAddress,
      Integer attachmentCount
  ) {}

  /** One GeoJSON Feature. {@code properties} keys vary by {@code fspEntityType}. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Feature(
      String type,
      Geometry geometry,
      Map<String, Object> properties
  ) {}

  /**
   * GeoJSON geometry. Only {@code Polygon} and {@code MultiPolygon}
   * are supported for FSP — points/lines aren't part of the spec.
   *
   * <p>Coordinates are nested arrays of doubles:
   * <ul>
   *   <li>{@code Polygon}: {@code coordinates: number[][][]} (rings of points)</li>
   *   <li>{@code MultiPolygon}: {@code coordinates: number[][][][]} (polygons of rings of points)</li>
   * </ul>
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Geometry(
      String type,
      List<Object> coordinates
  ) {}
}
