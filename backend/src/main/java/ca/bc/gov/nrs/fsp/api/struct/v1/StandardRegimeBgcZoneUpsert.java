package ca.bc.gov.nrs.fsp.api.struct.v1;

import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request body for inserting or updating a row of
 * {@code STANDARDS_REGIME_SITE_SERIES} via
 * {@code FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM}.
 *
 * <p>All seven BGC fields are sent verbatim — the legacy proc allows
 * any combination as long as the row is unique within the regime. Size
 * limits below mirror the table's column definitions.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardRegimeBgcZoneUpsert {
  @Size(max = 4)
  private String bgcZoneCode;

  @Size(max = 3)
  private String bgcSubzoneCode;

  @Size(max = 1)
  private String bgcVariant;

  @Size(max = 1)
  private String bgcPhase;

  @Size(max = 4)
  private String becSiteSeriesCd;

  @Size(max = 3)
  private String becSiteSeriesPhaseCd;

  @Size(max = 4)
  private String becSeral;
}
