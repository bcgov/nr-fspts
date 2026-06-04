package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp400AttachmentsDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class SubmissionAttachmentServiceTest {

  private Fsp400AttachmentsDao dao;
  private SubmissionAttachmentService service;

  @BeforeEach
  void freshMocks() {
    dao = Mockito.mock(Fsp400AttachmentsDao.class);
    when(dao.createAttachment(any(), any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(new Fsp400AttachmentsDao.CreateAttachmentResult(5001L, null))
        .thenReturn(new Fsp400AttachmentsDao.CreateAttachmentResult(5002L, null));
    service = new SubmissionAttachmentService(dao);
  }

  @Test
  void persists_each_file_as_OTHR_category() throws IOException {
    List<MultipartFile> files = List.of(
        new MockMultipartFile("attachments", "fdu-map.pdf", "application/pdf", "pdf-bytes".getBytes()),
        new MockMultipartFile("attachments", "appendix.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "docx-bytes".getBytes()));

    service.persist(files, 96L, 6L, /*expectedCount=*/ 2, "TESTUSR");

    verify(dao).createAttachment(
        eq(96L), eq("6"), eq("OTHR"), eq("fdu-map.pdf"),
        eq(9L), eq(""), eq("N"), eq("TESTUSR"));
    verify(dao).createAttachment(
        eq(96L), eq("6"), eq("OTHR"), eq("appendix.docx"),
        eq(10L), eq(""), eq("N"), eq("TESTUSR"));
    verify(dao).saveAttachmentContent(eq(5001L), eq("pdf-bytes".getBytes()));
    verify(dao).saveAttachmentContent(eq(5002L), eq("docx-bytes".getBytes()));
  }

  @Test
  void noop_when_no_files_supplied() throws IOException {
    service.persist(null, 96L, 6L, 0, "TESTUSR");
    verifyNoInteractions(dao);

    service.persist(List.of(), 96L, 6L, 0, "TESTUSR");
    verifyNoInteractions(dao);
  }

  @Test
  void empty_files_in_list_are_skipped() throws IOException {
    List<MultipartFile> files = List.of(
        new MockMultipartFile("attachments", "real.pdf", "application/pdf", "data".getBytes()),
        new MockMultipartFile("attachments", "empty.pdf", "application/pdf", new byte[0]));

    service.persist(files, 96L, 6L, 2, "TESTUSR");

    verify(dao, times(1)).createAttachment(
        any(), any(), any(), eq("real.pdf"), any(), any(), any(), any());
    verify(dao, times(1)).saveAttachmentContent(any(), any());
  }

  @Test
  void count_mismatch_is_logged_but_does_not_block_persistence() throws IOException {
    // XML says 3, request carries 1 — we still persist the 1
    List<MultipartFile> files = List.of(
        new MockMultipartFile("attachments", "only.pdf", "application/pdf", "x".getBytes()));

    service.persist(files, 96L, 6L, /*expectedCount=*/ 3, "TESTUSR");

    verify(dao, times(1)).createAttachment(
        any(), any(), any(), eq("only.pdf"), any(), any(), any(), any());
    verify(dao, times(1)).saveAttachmentContent(any(), any());
  }
}
