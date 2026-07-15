package ca.bc.gov.nrs.fsp.api.struct.v1;

/**
 * One attachment linked to an extension request (via fsp_extension_xref) —
 * e.g. the extension request letter or the DDM decision letter (EXDDMD).
 * Backs the Extension Summary dialog's per-extension "Attachments" list;
 * the file itself is fetched through the shared attachment-download
 * endpoint keyed on {@code attachmentId}.
 */
public record ExtensionAttachmentResponse(
    String attachmentId, String attachmentName, String typeCode) {}
