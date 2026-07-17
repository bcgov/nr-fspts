package ca.bc.gov.nrs.fsp.api.constants.v1;

public final class URL {
  private URL() {
  }

  public static final String BASE_URL = "/api/v1/fsp";

  // Code lists (dropdown options) — backed by FSP_CODE_LISTS / PKG_SIL_CODE_LISTS.
  public static final String CODE_LISTS_ORG_UNITS = "/code-lists/org-units";
  // Org units keyed by the 3-letter org_unit_code (e.g. "DCC") with
  // description = org_unit_name. Distinct from /code-lists/org-units
  // (which is keyed by numeric org_unit_no for the search filter).
  // Used by the SPA to expand the comma-separated abbreviation list
  // returned in each FSP search result row into full district names.
  public static final String CODE_LISTS_ORG_UNIT_CODES = "/code-lists/org-unit-codes";
  public static final String CODE_LISTS_FSP_STATUS = "/code-lists/fsp-status";
  public static final String CODE_LISTS_FSP_AMENDMENT_NUMBERS =
      "/code-lists/fsp-amendment-numbers";
  // Silviculture tree species codes — backs the Standards View
  // Preferred/Acceptable Species dropdowns. Cached client-side.
  public static final String CODE_LISTS_SPECIES = "/code-lists/species";
  // Silviculture statute codes — backs the Stocking Standards
  // "Regulation" dropdown. Loaded from FSP_CODE_LISTS.GET_STATUTE_CD
  // (SILV_STATUTE_CODE table) so the SPA doesn't hard-code values
  // that would drift from the DB.
  public static final String CODE_LISTS_STATUTES = "/code-lists/statutes";

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
  // POST — duplicate an existing standards regime on the same FSP /
  // amendment via FSP_550_STDS_PROPOSAL.COPY. Used by the Copy Standard
  // button on the Stocking Standards tab (DFT-only).
  public static final String STANDARD_COPY = "/{fspId}/standards/{regimeId}/copy";
  // Legacy "Add default standard" — LINK a shared MoF default regime onto the
  // FSP (ASSOC_FSP_TO_STD_REGIME). Distinct from COPY (which clones a draft).
  public static final String STANDARD_LINK = "/{fspId}/standards/{regimeId}/link";
  // Legacy "Unlink Default Standard" — remove the FSP↔regime link only
  // (UNLINK_DEFAULT_STANDARDS); the shared regime survives. POST (an action),
  // not DELETE (which would tear the regime down).
  public static final String STANDARD_UNLINK = "/{fspId}/standards/{regimeId}/unlink";
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
  public static final String ATTACHMENTS = "/{fspId}/attachments";
  public static final String ATTACHMENT_BY_ID = "/{fspId}/attachments/{attachmentId}";
  public static final String ATTACHMENT_DOWNLOAD = "/{fspId}/attachments/{attachmentId}/download";
  // Per-FSP attachment-category dropdown for the upload dialog —
  // mirrors FSP_CODE_LISTS.get_attach_reference_list(p_fsp_id).
  public static final String ATTACHMENT_CATEGORIES = "/{fspId}/attachment-categories";
  public static final String INBOX = "/inbox";
  public static final String HISTORY = "/{fspId}/history";
  public static final String EXTENSIONS = "/{fspId}/extensions";
  // POST (multipart) — upload an extension-linked attachment (e.g. the
  // EXDDMD decision letter) via FSP_302_EXTENSION_REQUEST.CREATE_ATTACHMENT.
  public static final String EXTENSION_ATTACHMENTS =
      "/{fspId}/extensions/{extensionId}/attachments";
  // POST — flip a Draft FSP/amendment to Submitted via
  // FSP_300_INFORMATION.MAINLINE(P_ACTION=SUBMIT). The proc transitions
  // DFT → SUB when approval_required_ind='Y' (the typical path) or
  // DFT → IN-EFFECT directly when approval_required_ind='N'.
  public static final String SUBMIT = "/{fspId}/submit";
  // POST — create a new amendment row on an existing FSP via
  // FSP_300_INFORMATION.MAINLINE(P_ACTION=AMEND). The proc assigns
  // the next amendment_number and seeds the row with carry-forward
  // licensees / org-units from the prior approved amendment. Returns
  // the new amendment as an FspInformation DTO so the SPA can
  // navigate straight to it.
  public static final String AMEND = "/{fspId}/amend";
  // POST — create a new replacement amendment row on an existing FSP
  // via FSP_300_INFORMATION.MAINLINE(P_ACTION=REPLACE). Same shape as
  // AMEND but the proc stamps fsp_amendment_code='RPL' and forces
  // approval-required.
  public static final String REPLACE = "/{fspId}/replace";
  // GET — Submit preflight. Runs fsp_common_validation.validate_fsp
  // and returns the accumulated FSP.* error codes + curated messages
  // so the SPA can render a checklist before the user hits Submit.
  public static final String SUBMIT_PREFLIGHT = "/{fspId}/submit/preflight";
  public static final String FDU_LIST = "/{fspId}/fdu-list";
  public static final String FDU_LICENCES = "/{fspId}/fdus/{fduId}/licences";
  // GET — existence check for a single licence number against
  // PROV_FOREST_USE. Lets the Edit-licences dialog validate a number
  // the moment the user clicks Add rather than failing the whole batch
  // at save time.
  public static final String LICENCE_EXISTS = "/{fspId}/licence-exists";

  // Map View extent — bounding box of all FDU polygons for this FSP +
  // amendment. Fetched lazily by the front-end inbox/results pages so
  // the spatial query only runs when the user actually clicks Map View.
  public static final String EXTENT = "/{fspId}/amendments/{amendmentNumber}/extent";

  // FDU polygons as WGS84 GeoJSON for the embedded Leaflet map — the full
  // ring geometry behind the EXTENT bounding box, reprojected from BC
  // Albers so the frontend can render it directly.
  public static final String FDU_GEOMETRY =
      "/{fspId}/amendments/{amendmentNumber}/fdu-geometry";

  // District auto-notification designates — admin-only list of IDIR
  // usernames CC'd on FSP-200 notification emails for an org unit.
  // Backed by FSP_900_NOTIFICATION_DESIGNATE (GET/SAVE/REMOVE).
  public static final String DISTRICT_DESIGNATES = "/admin/district-notifications";
  public static final String DISTRICT_DESIGNATE_BY_ID = "/admin/district-notifications/{designateId}";

  // IDIR directory lookup via nr-user-lookup-api. Used by the
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
