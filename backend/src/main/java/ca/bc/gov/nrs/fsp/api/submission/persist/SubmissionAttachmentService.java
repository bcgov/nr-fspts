package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp400AttachmentsDao;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Increment 5: file-attachment intake. The submission XML carries
 * only {@code attachmentCount} — no per-file metadata — so the UI
 * uploads files alongside the XML in the same multipart request.
 * Each file becomes an FSP-level attachment under the new amendment.
 *
 * <p>Open assumptions:
 * <ul>
 *   <li><b>Type code defaults to "OTHR"</b> (Supporting Documents).
 *       The legacy schema categorises attachments across 9 type codes
 *       (FSP / AMDS / SS / MAP / FRPA196(1) / FRPA196(2) / FPPR14(4) /
 *       OTHR / DDMD). To classify uploads per-file the UI needs to
 *       send a parallel array of category codes; that's deferred.</li>
 *   <li><b>Count mismatch is logged, not enforced.</b> If the XML
 *       declares {@code attachmentCount=3} but only 2 files arrive,
 *       we still persist the 2 and let the user re-upload the missing
 *       one via the existing {@code POST /api/v1/fsp/{fspId}/attachments}
 *       endpoint. Strict enforcement may be added once we know the
 *       business rule.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SubmissionAttachmentService {

  /** Legacy FSP_ATTACHMENT_TYPE_CODE used for unclassified uploads. */
  static final String DEFAULT_TYPE_CODE = "OTHR";

  private static final String DEFAULT_CONSOLIDATED_IND = "N";

  private final Fsp400AttachmentsDao attachmentsDao;

  /**
   * Persist each uploaded file as an attachment on the (fspId,
   * amendmentNumber) being submitted. {@code expectedCount} is the
   * XML's {@code attachmentCount} — used to detect mismatch only.
   */
  public void persist(
      List<MultipartFile> files,
      long fspId,
      long amendmentNumber,
      int expectedCount,
      String userId)
      throws IOException {
    int actual = files == null ? 0 : files.size();
    if (actual != expectedCount) {
      log.warn(
          "Attachment count mismatch for fspId={} amendment={}: XML declared {}, request carried {}",
          fspId, amendmentNumber, expectedCount, actual);
    }
    if (actual == 0) {
      return;
    }

    String amendmentString = Long.toString(amendmentNumber);
    log.info("Persisting {} attachment(s) for fspId={} amendment={}",
        actual, fspId, amendmentNumber);

    for (MultipartFile file : files) {
      if (file == null || file.isEmpty()) {
        continue;
      }
      Fsp400AttachmentsDao.CreateAttachmentResult created = attachmentsDao.createAttachment(
          fspId,
          amendmentString,
          DEFAULT_TYPE_CODE,
          file.getOriginalFilename(),
          file.getSize(),
          "",                       // description — UI doesn't supply yet
          DEFAULT_CONSOLIDATED_IND,
          userId);
      attachmentsDao.saveAttachmentContent(created.createdAttachmentId(), file.getBytes());
      log.debug("Attached '{}' ({} bytes) → attachmentId={}",
          file.getOriginalFilename(), file.getSize(), created.createdAttachmentId());
    }
  }
}
