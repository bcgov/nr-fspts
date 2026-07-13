package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp302ExtensionRequestDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.io.ByteArrayInputStream;
import java.sql.Types;

@Repository
public class Fsp302ExtensionRequestDaoImpl extends AbstractStoredProcedureDao
    implements Fsp302ExtensionRequestDao {

  // FSP_302_EXTENSION_REQUEST.SAVE — 11 positional params, see proc body
  // R__06395_FSP_302_EXTENSION_REQUEST.sql:216-228.
  private static final String CALL_SAVE =
      "{call " + PACKAGE_NAME + ".SAVE(?,?,?,?,?,?,?,?,?,?,?)}";
  // CREATE_ATTACHMENT — 10 positional params (p_extension_id INOUT,
  // p_blob OUT, p_attachment_id OUT, p_error_message OUT).
  private static final String CALL_CREATE_ATTACHMENT =
      "{call " + PACKAGE_NAME + ".CREATE_ATTACHMENT(?,?,?,?,?,?,?,?,?,?)}";
  private static final String CALL_SAVE_ATTACHMENT_CONTENT =
      "{call " + PACKAGE_NAME + ".SAVE_ATTACHMENT_CONTENT(?,?,?)}";

  public Fsp302ExtensionRequestDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public SaveResult save(SaveRequest req) {
    return executeCall(CALL_SAVE,
        cs -> {
          cs.setString(1, req.fspId());                       // IN
          // INOUT — null on insert, the proc writes back the assigned id.
          setInOutString(cs, 2, req.extensionId());
          cs.setString(3, req.newPlanTermYears());            // IN
          cs.setString(4, req.newPlanTermMonths());           // IN
          cs.setString(5, req.newFspExpiryDate());            // IN
          cs.setString(6, req.statusComment());               // IN
          cs.setString(7, req.userClientNumber());            // IN
          cs.setString(8, req.userRole());                    // IN
          cs.setString(9, req.userId());                      // IN
          cs.setString(10, req.revisionCount());              // IN
          setInOutString(cs, 11, "");                         // INOUT error
        },
        cs -> {
          String error = cs.getString(11);
          throwIfError(PACKAGE_NAME, "SAVE", error);
          return new SaveResult(cs.getString(2), req.revisionCount(), error);
        });
  }

  @Override
  public CreateAttachmentResult createAttachment(
      String extensionId, String attachmentType, String filename,
      Long fileSize, String description, String consolidatedInd, String userId) {
    return executeCall(CALL_CREATE_ATTACHMENT,
        cs -> {
          setInOutString(cs, 1, extensionId);              // INOUT extension id
          cs.setString(2, attachmentType);
          cs.setString(3, filename);
          cs.setString(4, fileSize == null ? null : String.valueOf(fileSize));
          cs.setString(5, description);
          cs.registerOutParameter(6, Types.BLOB);          // empty blob OUT
          cs.setString(7, consolidatedInd);
          cs.setString(8, userId);
          cs.registerOutParameter(9, Types.VARCHAR);       // created attachment_id
          cs.registerOutParameter(10, Types.VARCHAR);      // p_error_message
        },
        cs -> {
          String idStr = cs.getString(9);
          String error = cs.getString(10);
          throwIfError(PACKAGE_NAME, "CREATE_ATTACHMENT", error);
          Long createdId = (idStr == null || idStr.isBlank()) ? null : Long.valueOf(idStr.trim());
          return new CreateAttachmentResult(createdId, error);
        });
  }

  @Override
  public String saveAttachmentContent(Long attachmentId, byte[] content) {
    return executeCall(CALL_SAVE_ATTACHMENT_CONTENT,
        cs -> {
          cs.setString(1, String.valueOf(attachmentId));
          cs.setBlob(2, new ByteArrayInputStream(content), content.length);
          cs.registerOutParameter(3, Types.VARCHAR);
        },
        cs -> {
          String error = cs.getString(3);
          throwIfError(PACKAGE_NAME, "SAVE_ATTACHMENT_CONTENT", error);
          return error;
        });
  }
}
