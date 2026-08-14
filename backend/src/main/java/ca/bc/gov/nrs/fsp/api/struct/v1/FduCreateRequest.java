package ca.bc.gov.nrs.fsp.api.struct.v1;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Payload for {@code POST /v1/fsp/{fspId}/fdus} — the "Add FDU" dialog.
 *
 * <p>{@code @JsonIgnoreProperties} because the app runs with
 * {@code fail-on-unknown-properties=true}; a GIS-flavoured extra key would
 * otherwise become a deserialization 400 rather than a validation message.
 */
@Data
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class FduCreateRequest {

  /** FDU name. Required, max 120 characters, unique within the amendment. */
  private String fduName;

  /**
   * The boundary, as GeoJSON (a Polygon/MultiPolygon geometry, a Feature, or
   * a single-feature FeatureCollection) or WKT. Required — an FDU header
   * without geometry would still satisfy {@code has_new_fdu_spatial} and let
   * the plan be submitted claiming FDU changes with nothing spatial behind
   * them.
   */
  private String geometry;

  /**
   * SRID to assume when the geometry carries none (WKT always, GeoJSON
   * without a {@code crs} member). Defaults to BC Albers, 3005.
   */
  private Integer srid;

  /** Forest-use licence numbers to attach. Optional; each is validated. */
  private List<String> licenceNumbers;
}
