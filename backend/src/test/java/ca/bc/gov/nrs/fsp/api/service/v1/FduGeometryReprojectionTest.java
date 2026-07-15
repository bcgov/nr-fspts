package ca.bc.gov.nrs.fsp.api.service.v1;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateReferenceSystem;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;

/**
 * Guards the BC Albers (EPSG:3005) → WGS84 reprojection used by
 * {@link FduGeometryGeoJsonService}. The proj4j CRS is defined by a proj
 * string in the service; if that string drifts, FDU outlines land in the
 * wrong place on the Leaflet map (silent — no error). These anchor points
 * are derivable from the projection definition, so they pin it down
 * without needing live geometry.
 *
 * <p>The proj string MUST match the one in FduGeometryGeoJsonService.
 */
class FduGeometryReprojectionTest {

  private static final String SRC_ALBERS =
      "+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 "
          + "+x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs";
  private static final String DST_WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

  private static CoordinateTransform transform() {
    CRSFactory f = new CRSFactory();
    CoordinateReferenceSystem src = f.createFromParameters("EPSG:3005", SRC_ALBERS);
    CoordinateReferenceSystem dst = f.createFromParameters("EPSG:4326", DST_WGS84);
    return new CoordinateTransformFactory().createTransform(src, dst);
  }

  @Test
  void falseOrigin_mapsToCentralMeridianAndLatOrigin() {
    // At the central meridian (lon_0 = -126) and latitude of origin
    // (lat_0 = 45), the Albers easting equals the false easting
    // (x_0 = 1,000,000) and northing equals 0. So (1000000, 0) must round-
    // trip to (lon -126, lat 45).
    ProjCoordinate out = new ProjCoordinate();
    transform().transform(new ProjCoordinate(1_000_000, 0), out);

    assertThat(out.x).as("longitude").isCloseTo(-126.0, org.assertj.core.data.Offset.offset(1e-6));
    assertThat(out.y).as("latitude").isCloseTo(45.0, org.assertj.core.data.Offset.offset(1e-6));
  }

  @Test
  void knownBcPoint_reprojectsIntoBritishColumbia() {
    // A real BC Albers coordinate (near the provincial centroid) must land
    // in a plausible BC lon/lat window — a coarse guard that the transform
    // direction (x=easting→lng, y=northing→lat) isn't swapped.
    ProjCoordinate out = new ProjCoordinate();
    transform().transform(new ProjCoordinate(1_200_000, 900_000), out);

    assertThat(out.x).as("longitude").isBetween(-139.0, -114.0);
    assertThat(out.y).as("latitude").isBetween(48.0, 60.0);
  }
}
