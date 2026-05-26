package ca.bc.gov.nrs.fsp.api.constants.v1;

public final class URL {
  private URL() {
  }

  public static final String BASE_URL = "/api/v1/fsp";

  // Code lists (dropdown options) — backed by FSP_CODE_LISTS / PKG_SIL_CODE_LISTS.
  public static final String CODE_LISTS_ORG_UNITS = "/code-lists/org-units";
  public static final String CODE_LISTS_FSP_STATUS = "/code-lists/fsp-status";

  // FSP
  public static final String FSP_SEARCH = "/search";
  public static final String FSP_BY_ID = "/{fspId}";

  // Sub-resources (used relative to BASE_URL + FSP_BY_ID)
  public static final String WORKFLOW = "/{fspId}/workflow";
  public static final String WORKFLOW_ACTION = "/{fspId}/workflow/action";
  public static final String STANDARDS = "/{fspId}/standards";
  public static final String STANDARD_BY_ID = "/{fspId}/standards/{standardId}";
  public static final String ATTACHMENTS = "/{fspId}/attachments";
  public static final String ATTACHMENT_BY_ID = "/{fspId}/attachments/{attachmentId}";
  public static final String ATTACHMENT_DOWNLOAD = "/{fspId}/attachments/{attachmentId}/download";
  public static final String INBOX = "/inbox";
  public static final String HISTORY = "/{fspId}/history";

  // Map View extent — bounding box of all FDU polygons for this FSP +
  // amendment. Fetched lazily by the front-end inbox/results pages so
  // the spatial query only runs when the user actually clicks Map View.
  public static final String EXTENT = "/{fspId}/amendments/{amendmentNumber}/extent";
}
