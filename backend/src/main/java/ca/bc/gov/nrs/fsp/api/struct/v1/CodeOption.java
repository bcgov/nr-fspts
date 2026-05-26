package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Generic code/label pair used by code-list endpoints (org units, FSP
 * status codes, etc.). The legacy webADE OptionBean tracked code +
 * description + ext_description; we collapse to a single description
 * field because the front-end only consumes one label.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CodeOption {
  private String code;
  private String description;
}
