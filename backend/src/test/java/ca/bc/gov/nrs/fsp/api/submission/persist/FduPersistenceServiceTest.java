package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.GmlGeometryConverter;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionEnvelopeStripper;
import ca.bc.gov.nrs.fsp.api.submission.parser.SubmissionXmlParser;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.validator.SchemaValidator;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.core.io.ClassPathResource;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Mocks {@link FduWriteDao} and asserts that the service walks the
 * sanitized Mackenzie fixture (2 FDUs) and issues the right sequence
 * of DAO calls per FDU: nextFduId → insertFduHeader → insertFduGeometry
 * → insertFduLicence(...). Real Oracle write-paths are not exercised
 * (no test DB available).
 */
class FduPersistenceServiceTest {

  private static SubmissionXmlParser parser;
  private static SubmissionEnvelopeStripper stripper;
  private static GmlGeometryConverter converter;

  private FduWriteDao dao;
  private FduPersistenceService service;

  @BeforeAll
  static void wirePipeline() throws Exception {
    SchemaValidator sv = new SchemaValidator();
    invokePostConstruct(sv, "compileSchema");
    parser = new SubmissionXmlParser(sv);
    invokePostConstruct(parser, "initContext");
    stripper = new SubmissionEnvelopeStripper();
    converter = new GmlGeometryConverter();
  }

  @BeforeEach
  void freshMocks() {
    dao = Mockito.mock(FduWriteDao.class);
    when(dao.lookupFduFeatureClassSkey()).thenReturn(42L);
    // Hand out distinct FDU ids each call so we can correlate them
    // back to the inserts.
    when(dao.nextFduId()).thenReturn(1001L, 1002L, 1003L);
    service = new FduPersistenceService(converter, dao);
  }

  @Test
  void persists_two_fdus_with_geometry_and_licences() throws Exception {
    ForestStewardshipPlanType plan = parsePlan("valid-mackenzie-96-amend6.xml");

    service.persist(plan, 96L, 6L, "TESTUSR");

    // Two FDUs in the fixture
    verify(dao, times(2)).nextFduId();
    verify(dao, atLeast(1)).lookupFduFeatureClassSkey();

    // Header writes — one per FDU, with the right names
    verify(dao).insertFduHeader(eq(96L), eq(6L), eq(1001L), eq("Sample North FDU"), eq("TESTUSR"));
    verify(dao).insertFduHeader(eq(96L), eq(6L), eq(1002L), eq("Sample South FDU"), eq("TESTUSR"));

    // Geometry writes — capture WKT + SRID + computed area/perimeter
    ArgumentCaptor<String> wkt = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<Integer> srid = ArgumentCaptor.forClass(Integer.class);
    ArgumentCaptor<Double> area = ArgumentCaptor.forClass(Double.class);
    ArgumentCaptor<Double> perimeter = ArgumentCaptor.forClass(Double.class);
    verify(dao, times(2)).insertFduGeometry(
        eq(96L), eq(6L), anyLong(), eq(42L),
        wkt.capture(), srid.capture(), area.capture(), perimeter.capture(),
        eq("TESTUSR"));

    assertThat(wkt.getAllValues()).allMatch(w -> w.startsWith("MULTIPOLYGON") || w.startsWith("POLYGON"));
    // EPSG:42102 in the source XML — legacy NAD83/BC Albers code, remapped
    // to the canonical 3005 by GmlGeometryConverter before SDO_GEOMETRY bind.
    assertThat(srid.getAllValues()).containsOnly(3005);
    assertThat(area.getAllValues()).allMatch(a -> a > 0.0);
    assertThat(perimeter.getAllValues()).allMatch(p -> p > 0.0);

    // Each FDU in the fixture has at least one licence
    verify(dao, atLeast(2)).insertFduLicence(eq(96L), eq(6L), anyLong(), anyString(), eq("TESTUSR"));
  }

  @Test
  void noop_when_plan_has_no_fdus() throws Exception {
    ForestStewardshipPlanType empty = new ForestStewardshipPlanType();
    // no fduList set

    service.persist(empty, 96L, 6L, "TESTUSR");

    Mockito.verifyNoInteractions(dao);
  }

  // -------- helpers --------

  private static ForestStewardshipPlanType parsePlan(String fixture) throws Exception {
    byte[] raw = new ClassPathResource("fixtures/submissions/" + fixture).getInputStream().readAllBytes();
    byte[] fspBytes = stripper.toBareFspSubmission(raw);
    FSPSubmissionType submission = parser.parse(fspBytes).submission();
    if (submission == null) {
      throw new IllegalStateException("failed to parse " + fixture);
    }
    return submission.getSubmissionItem().getForestStewardshipPlan();
  }

  private static void invokePostConstruct(Object bean, String methodName) throws Exception {
    Method m = bean.getClass().getDeclaredMethod(methodName);
    m.setAccessible(true);
    m.invoke(bean);
  }
}
