package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Per-layer detail for the FSP250 "Standards View" layer sub-tabs.
 * Composes FSP_550_SUB_LAYERS.GET (density/spacing values) with two
 * FSP_550_SUB_SPECIES.GET calls (preferred + acceptable species).
 */
public record StandardRegimeLayerDetail(
    String layerCode,
    String layerId,
    String treeSizeUnitCode,
    String targetStocking,
    String minHorizontalDistance,
    String minPrefStockingStandard,
    String minStockingStandard,
    String residualBasalArea,
    String minPostSpacing,
    String maxPostSpacing,
    String maxConifer,
    String heightRelativeToComp,
    List<Species> preferredSpecies,
    List<Species> acceptableSpecies
) {

  public record Species(String code, String description, String minHeight) {}
}
