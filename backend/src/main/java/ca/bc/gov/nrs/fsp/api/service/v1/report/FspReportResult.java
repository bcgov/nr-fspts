package ca.bc.gov.nrs.fsp.api.service.v1.report;

import org.springframework.http.MediaType;

public record FspReportResult(byte[] content, String filename, MediaType mediaType) {}
