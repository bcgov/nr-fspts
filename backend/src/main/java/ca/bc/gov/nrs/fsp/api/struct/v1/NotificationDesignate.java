package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One row in the district auto-notification designate list — an IDIR
 * username that gets CC'd on FSP-200 notification emails for a given
 * org unit.
 *
 * <p>Legacy returned an email address too, looked up via WebADE; that
 * path isn't ported (we don't have an IDIR identity-lookup service
 * wired up yet). Field is kept on the DTO for forward-compat — it'll
 * be null until the lookup is plumbed in.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NotificationDesignate {
  /** Server-assigned id; null on POST (add), populated on GET. */
  private String designateId;
  /** IDIR username (e.g. "IDIR\\JSMITH"). Required on POST. */
  private String designateIdir;
  /** Org unit the designate belongs to. Required on POST; omitted on
   *  GET rows (the response is already scoped to the requested org unit). */
  private String orgUnitNo;
  /** Display name from the FAM identity-lookup API. Null on rows where
   *  the lookup failed or returned no match; the UI falls back to the
   *  IDIR username when this is empty. */
  private String displayName;
  /** Email address from the FAM identity-lookup API. Same null
   *  semantics as displayName. */
  private String emailAddress;
}
