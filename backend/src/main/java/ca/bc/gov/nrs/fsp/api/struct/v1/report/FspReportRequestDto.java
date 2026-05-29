package ca.bc.gov.nrs.fsp.api.struct.v1.report;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDate;

/**
 * Generic report-request payload. The Jasper layer only cares about
 * the format + the parameter slots that downstream stored procs read;
 * each report defines its own subset via {@code FspReportParameterProvider}.
 *
 * <p>Mirrors nr-rept's ReptReportRequestDto shape with FSP-specific
 * filter fields. Add fields as new report definitions need them —
 * unused fields stay null in JSON for callers that don't supply them.</p>
 */
public record FspReportRequestDto(
    @JsonFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
    @JsonFormat(pattern = "yyyy-MM-dd") LocalDate endDate,
    /** Org unit / district number filter. */
    String orgUnitNo,
    /** FSP status code (DFT/SUB/APP/REJ etc.). */
    String fspStatusCode,
    /** Agreement-holder client number. */
    String ahClientNumber,
    /** FSP id for single-plan reports (e.g. stocking standards by FSP). */
    String fspId,
    /** Optional sort column hint passed straight to the proc. */
    String sortColumn,
    /** Output format. Defaults to PDF when null. */
    FspReportFormat format
) {}
