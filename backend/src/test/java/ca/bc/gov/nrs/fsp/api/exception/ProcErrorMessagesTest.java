package ca.bc.gov.nrs.fsp.api.exception;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ProcErrorMessagesTest {

  /** Must match the length check in the frontend's isTechnicalError. */
  private static final int FRONTEND_MAX_MESSAGE_LENGTH = 240;

  @Test
  void everyMessageFitsTheFrontendLengthLimit() {
    ProcErrorMessages.all().forEach((code, info) ->
        assertTrue(info.message().length() <= FRONTEND_MAX_MESSAGE_LENGTH,
            () -> code + " is " + info.message().length()
                + " characters; the frontend would replace it with a generic error"));
  }

  @Test
  void extensionEndDateCodeIsMappedToBadRequest() {
    String code = ProcErrorMessages.mostSpecificMatchedCode("FSP.INVALID.EXT.END.DATE; ");

    assertEquals("FSP.INVALID.EXT.END.DATE", code);
    ProcErrorMessages.Info info = ProcErrorMessages.infoFor(code);
    assertEquals(HttpStatus.BAD_REQUEST, info.status());
    assertTrue(info.message().contains("current expiry date"));
  }

  @Test
  void shortExtensionEndDateCodeKeepsItsOwnMessage() {
    String code = ProcErrorMessages.mostSpecificMatchedCode("FSP.INVALID.EXT.END.DATE.SHORT; ");

    assertEquals("FSP.INVALID.EXT.END.DATE.SHORT", code);
    assertTrue(ProcErrorMessages.infoFor(code).message().contains("effective date"));
  }
}
