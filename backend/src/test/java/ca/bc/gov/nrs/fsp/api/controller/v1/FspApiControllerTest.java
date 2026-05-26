package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.service.v1.AttachmentsService;
import ca.bc.gov.nrs.fsp.api.service.v1.ClientSearchService;
import ca.bc.gov.nrs.fsp.api.service.v1.CodeListsService;
import ca.bc.gov.nrs.fsp.api.service.v1.FspService;
import ca.bc.gov.nrs.fsp.api.service.v1.HistoryService;
import ca.bc.gov.nrs.fsp.api.service.v1.InboxService;
import ca.bc.gov.nrs.fsp.api.service.v1.StandardsService;
import ca.bc.gov.nrs.fsp.api.service.v1.WorkflowService;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspSearchResult;
import ca.bc.gov.nrs.fsp.api.struct.v1.PageableResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Smoke tests that the controller routes wire to the right service method.
 * Service implementations are mocked — DAO tests against the real Oracle
 * packages live separately. Authentication is enforced at the JWT validation
 * layer via FsptsRoleValidator; here we use a plain mock JWT.
 *
 * <p>Every {@code @Service} bean the FSP + Client controllers depend on
 * has to be {@code @MockitoBean}'d here even if a particular test
 * doesn't drive it — @SpringBootTest boots the full ApplicationContext
 * and the real implementations would otherwise need a live Oracle
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

  @Test
  void searchFsp_returnsRows() throws Exception {
    // FspService.search returns a PageableResponse<T> now; wrap the
    // single row in the same shape PageableResponse.of() would produce
    // (1 row, page 0, size 10).
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
  void getAttachments_returnsRows() throws Exception {
    when(attachmentsService.getByFspId("42")).thenReturn(List.of(
        AttachmentResponse.builder().fspAttachmentId("7").attachmentName("a.pdf").build()));

    mvc.perform(get("/api/v1/fsp/42/attachments").with(jwt()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fspAttachmentId").value("7"));
  }
}
