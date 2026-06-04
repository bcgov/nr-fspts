package ca.bc.gov.nrs.fsp.api.constants.v1;

public final class URL {
  private URL() {
  }

  public static final String BASE_URL = "/api/v1/fsp";

  // Code lists (dropdown options) — backed by FSP_CODE_LISTS / PKG_SIL_CODE_LISTS.
  public static final String CODE_LISTS_ORG_UNITS = "/code-lists/org-units";
  public static final String CODE_LISTS_FSP_STATUS = "/code-lists/fsp-status";
  public static final String CODE_LISTS_FSP_AMENDMENT_NUMBERS =
      "/code-lists/fsp-amendment-numbers";
  // Silviculture tree species codes — backs the Standards View
  // Preferred/Acceptable Species dropdowns. Cached client-side.
  public static final String CODE_LISTS_SPECIES = "/code-lists/species";

  // FSP
  public static final String FSP_SEARCH = "/search";
  public static final String FSP_BY_ID = "/{fspId}";

  // Sub-resources (used relative to BASE_URL + FSP_BY_ID)
  public static final String WORKFLOW = "/{fspId}/workflow";
  public static final String WORKFLOW_ACTION = "/{fspId}/workflow/action";
  // FSP_700_WORKFLOW read-only projection (review milestones, OTBH, DDM
  // decision, extension decision). Distinct from /workflow which returns
  // the FSP_800 audit cursor — the legacy app shipped both, repurposed
  // for the History and Workflow tabs respectively.
  public static final String WORKFLOW_STATE = "/{fspId}/workflow-state";
  public static final String STANDARDS = "/{fspId}/standards";
  public static final String STANDARD_BY_ID = "/{fspId}/standards/{standardId}";
  public static final String STANDARD_DETAIL = "/{fspId}/standards/{regimeId}/detail";
  // PUT-only endpoint for the Standards View Overview-tab edits.
  // Distinct from STANDARD_DETAIL so the GET method signature stays
  // narrow (no @RequestBody). Targets FSP_550_STDS_PROPOSAL.SAVE.
  public static final String STANDARD_OVERVIEW =
      "/{fspId}/standards/{regimeId}/overview";
  public static final String STANDARD_LAYER_DETAIL =
      "/{fspId}/standards/{regimeId}/layers/{layerCode}";
  // Per-layer species CRUD — POST adds, DELETE removes a row from the
  // preferred or acceptable list (?preferred=Y|N&revisionCount=… for
  // DELETE). Always returns the refreshed layer detail.
  public static final String STANDARD_LAYER_SPECIES =
      "/{fspId}/standards/{regimeId}/layers/{layerCode}/species";
  public static final String STANDARD_LAYER_SPECIES_BY_CODE =
      "/{fspId}/standards/{regimeId}/layers/{layerCode}/species/{speciesCode}";
  public static final String STANDARD_ATTACHMENT_DOWNLOAD =
      "/{fspId}/standards/{regimeId}/attachments/{attachmentId}/download";
  public static final String ATTACHMENTS = "/{fspId}/attachments";
  public static final String ATTACHMENT_BY_ID = "/{fspId}/attachments/{attachmentId}";
  public static final String ATTACHMENT_DOWNLOAD = "/{fspId}/attachments/{attachmentId}/download";
  public static final String INBOX = "/inbox";
  public static final String HISTORY = "/{fspId}/history";
  public static final String EXTENSIONS = "/{fspId}/extensions";
  public static final String FDU_LIST = "/{fspId}/fdu-list";
  public static final String IDENTIFIED_AREAS = "/{fspId}/identified-areas";

  // Map View extent — bounding box of all FDU polygons for this FSP +
  // amendment. Fetched lazily by the front-end inbox/results pages so
  // the spatial query only runs when the user actually clicks Map View.
  public static final String EXTENT = "/{fspId}/amendments/{amendmentNumber}/extent";

  // District auto-notification designates — admin-only list of IDIR
  // usernames CC'd on FSP-200 notification emails for an org unit.
  // Backed by FSP_900_NOTIFICATION_DESIGNATE (GET/SAVE/REMOVE).
  public static final String DISTRICT_DESIGNATES = "/admin/district-notifications";
  public static final String DISTRICT_DESIGNATE_BY_ID = "/admin/district-notifications/{designateId}";

  // IDIR directory lookup via FAM identity-lookup API. Used by the
  // UserSearchModal popup and to enrich designate rows with displayName
  // + email server-side.
  public static final String USER_SEARCH = "/users/search";

  // FSP XML submission — Phase 1 read-only validation endpoint. Replaces
  // the legacy ESF agent path that pulled XML off MOF_QUEUES.ESF_STATUS_Q.
  public static final String SUBMISSIONS_VALIDATE = "/submissions/validate";

  // Phase 2: validate + persist. Increment 1 only writes FSP_300 header
  // fields; FDU/IdentifiedArea/Standards/Attachment writes are layered
  // in subsequent increments. See SubmissionPersistenceService javadoc.
  public static final String SUBMISSIONS = "/submissions";
}
