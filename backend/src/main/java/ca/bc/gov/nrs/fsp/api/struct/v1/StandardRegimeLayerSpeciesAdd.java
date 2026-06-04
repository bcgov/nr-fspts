package ca.bc.gov.nrs.fsp.api.struct.v1;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request body for adding a species row to a Standards View layer.
 * Backs the Preferred/Acceptable composer rows; both lists share this
 * shape and differ only by {@code preferred} flag.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardRegimeLayerSpeciesAdd {
  /** SILV_TREE_SPECIES_CODE_NEW value (from the species code-list dropdown). */
  @NotBlank
  private String speciesCode;

  /** Optional minimum height — empty means none specified. */
  private String minHeight;

  /** {@code true} → preferred list, {@code false} → acceptable list. */
  private boolean preferred;
}
