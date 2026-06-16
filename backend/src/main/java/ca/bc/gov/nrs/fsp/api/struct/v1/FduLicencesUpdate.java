package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Payload for {@code PUT /v1/fsp/{fspId}/fdus/{fduId}/licences} — the
 * FDU licences edit dialog. Lists are exclusive sets: any id appearing
 * in both {@code add} and {@code remove} is treated as a no-op.
 *
 * <p>Empty lists are allowed and are no-ops, so the SPA can post just
 * additions or just removals without padding the other side.
 */
@Data
@NoArgsConstructor
public class FduLicencesUpdate {
  /** Forest-file ids to add to this FDU. Validated against PROV_FOREST_USE. */
  private List<String> add;
  /** Forest-file ids to remove from this FDU. No validation needed. */
  private List<String> remove;
}
