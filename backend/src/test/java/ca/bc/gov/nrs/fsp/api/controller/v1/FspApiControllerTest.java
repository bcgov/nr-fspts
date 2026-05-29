package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.service.v1.AttachmentsService;
import ca.bc.gov.nrs.fsp.api.service.v1.ClientSearchService;
import ca.bc.gov.nrs.fsp.api.service.v1.CodeListsService;
import ca.bc.gov.nrs.fsp.api.service.v1.DistrictNotificationService;
import ca.bc.gov.nrs.fsp.api.service.v1.FspExtentService;
import ca.bc.gov.nrs.fsp.api.service.v1.FspService;
import ca.bc.gov.nrs.fsp.api.service.v1.HistoryService;
import ca.bc.gov.nrs.fsp.api.service.v1.InboxService;
import ca.bc.gov.nrs.fsp.api.service.v1.StandardsService;
import ca.bc.gov.nrs.fsp.api.service.v1.UserDirectoryService;
import ca.bc.gov.nrs.fsp.api.service.v1.WorkflowService;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.ClientSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.CodeOption;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspExtentResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.InboxRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.NotificationDesignate;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Smoke tests that the controller routes wire to the right service method.
 * Service implementations are mocked — DAO tests against the real Oracle
 * packages live separately. Authentication is enforced at the JWT
 * validation layer via FsptsRoleValidator; here we use a plain mock JWT.
 *
 * <p>Every {@code @Service} bean any controller depends on has to be
 * {@code @MockitoBean}'d here even if a particular test doesn't drive
 * it — {@code @SpringBootTest} boots the full ApplicationContext and
 * the real implementations would otherwise need a live Oracle
 * JdbcTemplate to instantiate.</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
class FspApiControllerTest {

  @Autowired MockMvc mvc;

  @MockitoBean FspService fspService;
  @MockitoBean WorkflowService workflowService;
  @MockitoBean StandardsService standardsService;
  @MockitoBean AttachmentsService attachmentsService;
  @MockitoBean InboxService inboxService;
  @MockitoBean HistoryService historyService;
  @MockitoBean CodeListsService codeListsService;
  @MockitoBean ClientSearchService clientSearchService;
  @MockitoBean FspExtentService fspExtentService;
  @MockitoBean DistrictNotificationService districtNotificationService;
  @MockitoBean UserDirectoryService userDirectoryService;

  @Test
  void searchFsp_returnsRows() throws Exception {
    // FspService.search returns a PageableResponse<T> now; wrap the
    // single row in the same shape PageableResponse.of() would produce.
    when(fspService.search(any(FspSearchRequest.class))).thenReturn(
        PageableResponse.of(
            List.of(FspSearchResult.builder().fspId("123").planName("Test Plan").build()),
            0,
            10));

    mvc.perform(get("/api/v1/fsp/search").with(jwt()))
        .andExpect(status().isOk())
        // Pageable response wraps the rows under `content`; the page
        // envelope sits alongside.
        .andExpect(jsonPath("$.content[0].fspId").value("123"))
        .andExpect(jsonPath("$.content[0].planName").value("Test Plan"))
        .andExpect(jsonPath("$.page.totalElements").value(1))
        .andExpect(jsonPath("$.page.number").value(0));
  }

  @Test
  void searchFsp_bindsQueryParamsToRequest() throws Exception {
    // Empty result is fine — this case asserts the criteria binding
    // round-trip, not the result rendering.
    when(fspService.search(any(FspSearchRequest.class))).thenReturn(
        PageableResponse.of(List.of(), 0, 10));

    mvc.perform(get("/api/v1/fsp/search")
            .param("fspId", "555")
            .param("fspStatusCode", "APP")
            .param("page", "2")
            .param("size", "25")
            .param("sortBy", "planName")
            .param("sortDir", "asc")
            .with(jwt()))
        .andExpect(status().isOk());

    ArgumentCaptor<FspSearchRequest> captor = ArgumentCaptor.forClass(FspSearchRequest.class);
    verify(fspService).search(captor.capture());
    FspSearchRequest req = captor.getValue();
    assertThat(req.getFspId()).isEqualTo("555");
    assertThat(req.getFspStatusCode()).isEqualTo("APP");
    assertThat(req.getPage()).isEqualTo(2);
    assertThat(req.getSize()).isEqualTo(25);
    assertThat(req.getSortBy()).isEqualTo("planName");
    assertThat(req.getSortDir()).isEqualTo("asc");
  }

  @Test
  void getInbox_returnsRows() throws Exception {
    // InboxService.getInbox now takes an InboxRequest and returns a
    // PageableResponse<FspSearchResult> (same envelope as search). The
    // route binds query params via Spring's standard form binding for
    // GET requests.
    when(inboxService.getInbox(any(InboxRequest.class))).thenReturn(
        PageableResponse.of(
            List.of(FspSearchResult.builder()
                .fspId("9001")
                .planName("Inbox Item")
                .fspStatusDesc("Submitted")
                .build()),
            0,
            10));

    mvc.perform(get("/api/v1/fsp/inbox").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[0].fspId").value("9001"))
        .andExpect(jsonPath("$.content[0].planName").value("Inbox Item"))
        .andExpect(jsonPath("$.content[0].fspStatusDesc").value("Submitted"))
        .andExpect(jsonPath("$.page.totalElements").value(1));
  }

  @Test
  void getInbox_forwardsCriteriaToService() throws Exception {
    when(inboxService.getInbox(any(InboxRequest.class))).thenReturn(
        PageableResponse.of(List.of(), 0, 10));

    mvc.perform(get("/api/v1/fsp/inbox")
            .param("orgUnitNo", "1001")
            .param("fspStatusCode", "DFT")
            .param("ahClientNumber", "00012345")
            .param("page", "1")
            .with(jwt()))
        .andExpect(status().isOk());

    ArgumentCaptor<InboxRequest> captor = ArgumentCaptor.forClass(InboxRequest.class);
    verify(inboxService).getInbox(captor.capture());
    InboxRequest req = captor.getValue();
    assertThat(req.getOrgUnitNo()).isEqualTo("1001");
    assertThat(req.getFspStatusCode()).isEqualTo("DFT");
    assertThat(req.getAhClientNumber()).isEqualTo("00012345");
    assertThat(req.getPage()).isEqualTo(1);
  }

  @Test
  void getAttachments_returnsRows() throws Exception {
    when(attachmentsService.getByFspId("42")).thenReturn(List.of(
        AttachmentResponse.builder().fspAttachmentId("7").attachmentName("a.pdf").build()));

    mvc.perform(get("/api/v1/fsp/42/attachments").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fspAttachmentId").value("7"));
  }

  @Test
  void getOrgUnits_returnsCodeOptions() throws Exception {
    // Code-list endpoints sit on the FSP controller too (route
    // /api/v1/fsp/code-lists/*). Verifies the lookup wiring + locks
    // in the CodeOption envelope as simple {code, description}.
    when(codeListsService.getOrgUnits()).thenReturn(List.of(
        CodeOption.builder().code("DPG").description("DPG – Penticton").build()));

    mvc.perform(get("/api/v1/fsp/code-lists/org-units").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].code").value("DPG"))
        .andExpect(jsonPath("$[0].description").value("DPG – Penticton"));
  }

  @Test
  void searchClients_returnsPageableResponse() throws Exception {
    // ClientApiController lives at /api/v1/clients (not /api/v1/fsp)
    // because client search is a generic resource. Same Spring context
    // though, so the same JWT auth applies and the same MockitoBean
    // pattern works.
    when(clientSearchService.search(any(ClientSearchRequest.class))).thenReturn(
        PageableResponse.of(
            List.of(ClientSearchResult.builder()
                .clientNumber("00012345")
                .clientAcronym("TOLKO")
                .clientName("Tolko Industries Ltd.")
                .build()),
            0,
            10));

    mvc.perform(get("/api/v1/clients/search").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[0].clientNumber").value("00012345"))
        .andExpect(jsonPath("$.content[0].clientAcronym").value("TOLKO"))
        .andExpect(jsonPath("$.page.totalElements").value(1));
  }

  @Test
  void getExtent_returnsMbrString() throws Exception {
    // Controller parses the path params to int and forwards to
    // FspExtentService — exact format of the extent string is left to
    // the service (and asserted there); this test only checks the
    // wiring + JSON envelope shape ({ extent: "..." }).
    when(fspExtentService.getExtent(8, 0)).thenReturn(
        FspExtentResponse.builder()
            .extent("1012145.0797,615135.6671,1013241.0073,616319.8139")
            .build());

    mvc.perform(get("/api/v1/fsp/8/amendments/0/extent").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.extent")
            .value("1012145.0797,615135.6671,1013241.0073,616319.8139"));
  }

  @Test
  void getExtent_returnsNullWhenNoGeometry() throws Exception {
    // FDU geometry is optional (FSPs without spatial data are valid);
    // service returns extent=null and the front-end treats that as
    // "no Map View available", so we shouldn't 404 here.
    when(fspExtentService.getExtent(42, 0)).thenReturn(
        FspExtentResponse.builder().extent(null).build());

    mvc.perform(get("/api/v1/fsp/42/amendments/0/extent").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.extent").doesNotExist());
  }

  @Test
  void getDistrictDesignates_returnsRowsForOrgUnit() throws Exception {
    when(districtNotificationService.getDesignates("1894")).thenReturn(List.of(
        NotificationDesignate.builder()
            .designateId("101").designateIdir("IDIR\\JSMITH").build(),
        NotificationDesignate.builder()
            .designateId("102").designateIdir("IDIR\\MBROWN").build()));

    mvc.perform(get("/api/v1/fsp/admin/district-notifications")
            .param("orgUnitNo", "1894").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].designateId").value("101"))
        .andExpect(jsonPath("$[0].designateIdir").value("IDIR\\JSMITH"))
        .andExpect(jsonPath("$[1].designateId").value("102"));
  }
}
