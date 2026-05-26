package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Map-view extent payload — the MBR ("minX,minY,maxX,maxY") of all
 * FDU polygons for an FSP + amendment, formatted exactly as the
 * legacy {@code openMapView(extent)} JS expected. {@code extent} is
 * null when the FSP/amendment has no FDU geometry; callers should
 * treat that as "no Map View available" rather than an error.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FspExtentResponse {
  private String extent;
}
