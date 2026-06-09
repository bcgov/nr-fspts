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
  // FSP501 — Standards Search (independent of an FSP context).
  public static final String STANDARDS_SEARCH = "/standards/search";
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
  // Regime-only GET (no FSP context). Used by the standards-search
  // modal where the user lands on a regime without picking an FSP.
  public static final String STANDARD_REGIME_DETAIL = "/standards/{regimeId}/detail";
  // PUT-only endpoint for the Standards View Overview-tab edits.
  // Distinct from STANDARD_DETAIL so the GET method signature stays
  // narrow (no @RequestBody). Targets FSP_550_STDS_PROPOSAL.SAVE.
  public static final String STANDARD_OVERVIEW =
      "/{fspId}/standards/{regimeId}/overview";
  public static final String STANDARD_LAYER_DETAIL =
      "/{fspId}/standards/{regimeId}/layers/{layerCode}";
  // Regime-only layer detail GET. Same payload as STANDARD_LAYER_DETAIL
  // but no FSP context — used by the standards-search dialog.
  public static final String STANDARD_REGIME_LAYER_DETAIL =
      "/standards/{regimeId}/layers/{layerCode}";
  // Per-layer species CRUD — POST adds, DELETE removes a row from the
  // preferred or acceptable list (?preferred=Y|N&revisionCount=… for
  // DELETE). Always returns the refreshed layer detail.
  public static final String STANDARD_LAYER_SPECIES =
      "/{fspId}/standards/{regimeId}/layers/{layerCode}/species";
  public static final String STANDARD_LAYER_SPECIES_BY_CODE =
      "/{fspId}/standards/{regimeId}/layers/{layerCode}/species/{speciesCode}";
  // Toggles a standards regime between single-layer ('I') and multi-layer
  // (1-4) via FSP_550_SUB_LAYERS.MAINLINE(CONVERT_LAYERS). The proc
  // auto-detects the current shape and converts in the opposite direction.
  //
  // Path note: deliberately NOT nested under /layers/ — that segment is
  // followed by {layerCode} on STANDARD_LAYER_DETAIL, so /layers/convert
  // would resolve to GET/PUT-only "layer with code 'convert'" → 405.
  public static final String STANDARD_LAYERS_CONVERT =
      "/{fspId}/standards/{regimeId}/convert-layers";
  // BGC site-series CRUD — POST inserts a new row, PUT updates the row
  // identified by {siteSeriesId}. Both target FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM
  // and return the refreshed regime detail so the BGC Zones tab redraws.
  public static final String STANDARD_BGC_ZONES =
      "/{fspId}/standards/{regimeId}/bgc-zones";
  public static final String STANDARD_BGC_ZONE_BY_ID =
      "/{fspId}/standards/{regimeId}/bgc-zones/{siteSeriesId}";
  // Upload endpoint for the Standards View Attachments tab. POST a
  // multipart file; backend hands it through FSP_550_STDS_PROPOSAL's
  // GET_ATTACHMENT_BLOB_FOR_UPDATE proc (the only writeable path FSP
  // roles can use against STANDARDS_REGIME_ATTACHMENT).
  public static final String STANDARD_ATTACHMENTS =
      "/{fspId}/standards/{regimeId}/attachments";
  public static final String STANDARD_ATTACHMENT_DOWNLOAD =
      "/{fspId}/standards/{regimeId}/attachments/{attachmentId}/download";
  public static final String ATTACHMENTS = "/{fspId}/attachments";
  public static final String ATTACHMENT_BY_ID = "/{fspId}/attachments/{attachmentId}";
  public static final String ATTACHMENT_DOWNLOAD = "/{fspId}/attachments/{attachmentId}/download";
  // Per-FSP attachment-category dropdown for the upload dialog —
  // mirrors FSP_CODE_LISTS.get_attach_reference_list(p_fsp_id).
  public static final String ATTACHMENT_CATEGORIES = "/{fspId}/attachment-categories";
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
