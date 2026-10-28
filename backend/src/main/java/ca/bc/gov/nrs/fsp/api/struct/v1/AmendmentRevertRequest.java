package ca.bc.gov.nrs.fsp.api.struct.v1;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Payload for {@code POST /v1/fsp/{fspId}/amendments/{amendmentNumber}/revert}.
 *
 * <p>{@code @JsonIgnoreProperties} because the app runs with
 * {@code fail-on-unknown-properties=true}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class AmendmentRevertRequest {

  /**
   * Why the administrator is reverting. Required; stored on the
   * FSP_STATUS_HISTORY row and included in the notification emails.
   * Length is checked in the service so the message is friendly.
   */
  private String reason;
}
