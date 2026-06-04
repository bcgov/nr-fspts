package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Editable subset of {@link StandardRegimeLayerDetail} accepted by the
 * Standards View → Layers SAVE endpoint. Carries only the layer-row
 * scalar density/spacing fields plus the tree-size unit; species rows
 * are managed independently by FSP_550_SUB_SPECIES and aren't part of
 * the layer SAVE.
 *
 * <p>Null in any field means "no change"; empty string clears the
 * corresponding column. The service overlays these onto a freshly-read
 * layer record so the SAVE proc gets a complete payload.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardRegimeLayerUpdate {
  private String treeSizeUnitCode;
  private String targetStocking;
  private String minHorizontalDistance;
  private String minPrefStockingStandard;
  private String minStockingStandard;
  private String residualBasalArea;
  private String minPostSpacing;
  private String maxPostSpacing;
  private String maxConifer;
  private String heightRelativeToComp;
}
