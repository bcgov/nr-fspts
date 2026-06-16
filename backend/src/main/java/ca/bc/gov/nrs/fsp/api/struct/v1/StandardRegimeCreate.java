package ca.bc.gov.nrs.fsp.api.struct.v1;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body for {@code POST /v1/fsp/{fspId}/standards} — creates a new
 * stocking standards regime keyed to the FSP + amendment in the path.
 * Mirrors the editable fields the legacy FSP550 (Stocking Standards
 * Proposal) screen exposed in its tombstone + regen-obligations
 * sections so a freshly-created regime is immediately usable on the
 * tab; layers / species / BGC zones are added separately via the
 * existing per-layer endpoints.
 *
 * <p>Fields the proc treats as system-managed (id, status, audit, etc.)
 * are absent — the service inserts an empty status that the proc
 * defaults appropriately for a draft regime.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardRegimeCreate {

  /** Amendment to attach the new regime to. Required. */
  @NotBlank
  private String fspAmendmentNumber;

  @NotBlank
  @Size(max = 50)
  private String standardsRegimeName;

  @NotBlank
  @Size(max = 50)
  private String standardsObjective;

  /**
   * Regulation code — values from {@code THE.SILV_STATUTE_CODE}. The
   * underlying column is {@code VARCHAR2(3)}; canonical values are
   * {@code "FRP"} and {@code "FPC"}. Defaults to FRP when omitted.
   */
  @Size(max = 3)
  private String regulationCode;

  @Size(max = 50)
  private String geographicDescription;

  /** ISO date — proc handles empty. */
  private String effectiveDate;
  private String expiryDate;

  /** "Y" / "N" — required at the proc level. */
  @NotBlank
  private String regenObligationInd;

  /** Numeric offsets — strings to match the proc's VARCHAR2 binds. */
  private String regenDelayOffsetYrs;
  private String freeGrowingEarlyOffsetYrs;
  private String freeGrowingLateOffsetYrs;
  private String noRegenEarlyOffsetYrs;
  private String noRegenLateOffsetYrs;

  private String additionalStandards;
}
