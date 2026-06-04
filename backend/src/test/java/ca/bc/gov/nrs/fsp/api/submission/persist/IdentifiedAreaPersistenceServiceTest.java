package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.IdentifiedAreaWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Programmatically builds a JAXB plan with one identified area (the
 * Mackenzie fixture has none — its amendment doesn't touch IAs). Asserts
 * the DAO sees a header insert with the right legislation type +
 * name, and a geometry insert with WKT + SRID.
 */
class IdentifiedAreaPersistenceServiceTest {

  private static final ObjectFactory OF = new ObjectFactory();
  private static final GmlGeometryConverter CONVERTER = new GmlGeometryConverter();

  private IdentifiedAreaWriteDao dao;
  private IdentifiedAreaPersistenceService service;

  @BeforeEach
  void freshMocks() {
    dao = Mockito.mock(IdentifiedAreaWriteDao.class);
    when(dao.lookupIdentifiedAreaFeatureClassSkey()).thenReturn(99L);
    when(dao.nextIdentifiedAreaId()).thenReturn(7001L, 7002L);
    service = new IdentifiedAreaPersistenceService(CONVERTER, dao);
  }

  @Test
  void persists_identified_area_header_and_geometry() {
    IdentifiedAreaType area = new IdentifiedAreaType();
    area.setIdentifiedAreaName("Caribou Habitat");
    area.setLegislationTypeCode("FRPA196(1)");
    area.setExtentOf(square(0, 0, 100));

    IdentifiedAreaAssociationType list = new IdentifiedAreaAssociationType();
    list.getIdentifiedArea().add(area);
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setIdentifiedAreasList(list);

    service.persist(plan, 96L, 6L, "TESTUSR");

    verify(dao, times(1)).nextIdentifiedAreaId();
    verify(dao).insertIdentifiedAreaHeader(
        eq(96L), eq(6L), eq(7001L),
        eq("FRPA196(1)"), eq("Caribou Habitat"), eq("TESTUSR"));

    ArgumentCaptor<String> wkt = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<Integer> srid = ArgumentCaptor.forClass(Integer.class);
    verify(dao).insertIdentifiedAreaGeometry(
        eq(96L), eq(6L), eq(7001L), eq(99L),
        wkt.capture(), srid.capture(), anyDouble(), anyDouble(), eq("TESTUSR"));
    assertThat(wkt.getValue()).startsWith("MULTIPOLYGON");
    // EPSG:42102 in the test builder — legacy NAD83/BC Albers, remapped to 3005.
    assertThat(srid.getValue()).isEqualTo(3005);
  }

  @Test
  void noop_when_plan_has_no_identified_areas() {
    ForestStewardshipPlanType empty = new ForestStewardshipPlanType();

    service.persist(empty, 96L, 6L, "TESTUSR");

    Mockito.verifyNoInteractions(dao);
  }

  @Test
  void persists_multiple_areas_with_distinct_ids() {
    IdentifiedAreaAssociationType list = new IdentifiedAreaAssociationType();
    list.getIdentifiedArea().add(buildArea("Area One", "FRPA196(1)", 0, 0));
    list.getIdentifiedArea().add(buildArea("Area Two", "FPPR14(4)", 200, 0));
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setIdentifiedAreasList(list);

    service.persist(plan, 96L, 6L, "TESTUSR");

    verify(dao, times(2)).nextIdentifiedAreaId();
    verify(dao).insertIdentifiedAreaHeader(
        eq(96L), eq(6L), eq(7001L), eq("FRPA196(1)"), eq("Area One"), eq("TESTUSR"));
    verify(dao).insertIdentifiedAreaHeader(
        eq(96L), eq(6L), eq(7002L), eq("FPPR14(4)"), eq("Area Two"), eq("TESTUSR"));
    verify(dao, times(2)).insertIdentifiedAreaGeometry(
        eq(96L), eq(6L), anyLong(), anyLong(),
        Mockito.anyString(), Mockito.anyInt(), anyDouble(), anyDouble(), eq("TESTUSR"));
  }

  // -------- builders --------

  private static IdentifiedAreaType buildArea(String name, String legType, double xOff, double yOff) {
    IdentifiedAreaType area = new IdentifiedAreaType();
    area.setIdentifiedAreaName(name);
    area.setLegislationTypeCode(legType);
    area.setExtentOf(square(xOff, yOff, 100));
    return area;
  }

  /**
   * Build a square MultiPolygon (one polygon, one outer ring) so we
   * exercise the same code path FDU writes take — extentOf is typed
   * SingleOrMultiplePolygonPropertyType.
   */
  private static SingleOrMultiplePolygonPropertyType square(double xOff, double yOff, double side) {
    LinearRingType ring = new LinearRingType();
    double[][] coords = {
        {xOff, yOff},
        {xOff + side, yOff},
        {xOff + side, yOff + side},
        {xOff, yOff + side},
        {xOff, yOff}
    };
    for (double[] xy : coords) {
      CoordType c = new CoordType();
      c.setX(BigDecimal.valueOf(xy[0]));
      c.setY(BigDecimal.valueOf(xy[1]));
      ring.getCoord().add(c);
    }
    LinearRingMemberType ringMember = new LinearRingMemberType();
    ringMember.setGeometry(OF.createLinearRing(ring));

    PolygonType polygon = new PolygonType();
    polygon.setOuterBoundaryIs(ringMember);

    PolygonMemberType polyMember = new PolygonMemberType();
    polyMember.setGeometry(OF.createPolygon(polygon));

    MultiPolygonType multi = new MultiPolygonType();
    multi.setSrsName("EPSG:42102");
    multi.getGeometryMember().add(OF.createPolygonMember(polyMember));

    SingleOrMultiplePolygonPropertyType extent = new SingleOrMultiplePolygonPropertyType();
    extent.setGeometry(OF.createMultiPolygon(multi));
    return extent;
  }
}
