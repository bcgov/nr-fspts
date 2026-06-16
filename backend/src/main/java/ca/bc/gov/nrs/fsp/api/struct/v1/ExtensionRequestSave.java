package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Payload for {@code POST /v1/fsp/{fspId}/extensions} — the "Extend
 * FSP" dialog. Mirrors the legacy FSP302 form. All fields optional on
 * the wire so the dialog can post a partial set when an admin is
 * editing a draft extension (admin-only path on the proc side); the
 * create flow expects at least the term + expiry triplet.
 */
@Data
@NoArgsConstructor
public class ExtensionRequestSave {
  private String planTermYears;
  private String planTermMonths;
  private String fspExpiryDate;
  private String statusComment;
  private String revisionCount;
}
