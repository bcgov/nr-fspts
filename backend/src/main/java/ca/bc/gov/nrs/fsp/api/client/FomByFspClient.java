package ca.bc.gov.nrs.fsp.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.net.URI;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

/**
 * Client for the <b>nr-fom</b> (Forest Operations Map) external API — the
 * public service that lists the FOMs referencing a given FSP. Used to fill
 * the "Associated FOMs" column on the FSP-300 agreement-holders table.
 *
 * <p>Single call: {@code GET {base-url}?fspId={fspId}} returning a JSON array
 * of {@code {fomId, name, fspId, forestClient:{id, name}}}. Each FOM ties to
 * one forest client; grouping by {@code forestClient.id} yields the FOM ids
 * associated with each agreement holder (matched on client number).
 *
 * <p>This mirrors the legacy {@code FomByFSPServiceImpl} +
 * {@code Fsp300InformationAction.populateFomByFSP}: the enrichment is
 * <b>best-effort</b> — any upstream failure returns an empty map so the FSP
 * detail load never fails on the FOM API being unreachable.
 *
 * <h3>Configuration</h3>
 * <ul>
 *   <li>{@code fsp.fom.base-url} — full URL prefix ending in
 *       {@code /api/external/fom-by-fsp}, supplied per environment via the
 *       {@code FOM_API_URL} deploy secret. Blank disables enrichment
 *       (client still builds; calls short-circuit).</li>
 * </ul>
 */
@Component
public class FomByFspClient {

  private static final Logger LOG = LoggerFactory.getLogger(FomByFspClient.class);

  private final RestClient http;
  private final boolean enabled;

  @Autowired
  public FomByFspClient(
      @Value("${fsp.fom.base-url:}") String baseUrl,
      @Value("${fsp.fom.connect-timeout:5s}") Duration connectTimeout,
      @Value("${fsp.fom.read-timeout:10s}") Duration readTimeout) {
    this.enabled = StringUtils.hasText(baseUrl);

    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Math.toIntExact(connectTimeout.toMillis()));
    factory.setReadTimeout(Math.toIntExact(readTimeout.toMillis()));
    this.http = RestClient.builder()
        .baseUrl(enabled ? baseUrl : "")
        .requestFactory(factory)
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();

    if (enabled) {
      LOG.info("FOM-by-FSP client active (base-url={})", baseUrl);
    } else {
      LOG.info(
          "FOM-by-FSP client inactive (no fsp.fom.base-url — the "
              + "Associated FOMs column will be empty; set FOM_API_URL to enable)");
    }
  }

  /** Test hook: inject a pre-built {@link RestClient} (e.g. bound to a
   *  MockRestServiceServer). */
  FomByFspClient(RestClient http) {
    this.http = http;
    this.enabled = true;
  }

  /**
   * Returns a map of {@code forestClient.id → comma-joined FOM ids} for the
   * given FSP, preserving upstream order. Empty when the API is disabled,
   * unreachable, or reports no FOMs. Never throws — enrichment is
   * best-effort and must not fail the FSP load.
   */
  public Map<String, String> fomIdsByForestClient(String fspId) {
    String id = normalize(fspId);
    if (!enabled || id == null) {
      return Map.of();
    }
    List<Fom> foms;
    try {
      foms = http.get()
          .uri(uriBuilder -> {
            URI uri = uriBuilder.queryParam("fspId", id).build();
            LOG.debug("fom-by-fsp: {}", uri);
            return uri;
          })
          .retrieve()
          .body(FOM_LIST);
    } catch (RuntimeException e) {
      LOG.warn("fom-by-fsp lookup failed for fspId={} — {}", id, e.toString());
      return Map.of();
    }
    if (foms == null || foms.isEmpty()) {
      return Map.of();
    }

    Map<String, StringJoiner> byClient = new LinkedHashMap<>();
    for (Fom fom : foms) {
      if (fom == null || fom.fomId() == null
          || fom.forestClient() == null || fom.forestClient().id() == null) {
        continue;
      }
      byClient.computeIfAbsent(fom.forestClient().id(), k -> new StringJoiner(", "))
          .add(fom.fomId());
    }
    Map<String, String> result = new LinkedHashMap<>();
    byClient.forEach((client, joiner) -> result.put(client, joiner.toString()));
    return result;
  }

  private static String normalize(String v) {
    return StringUtils.hasText(v) ? v.trim() : null;
  }

  private static final org.springframework.core.ParameterizedTypeReference<List<Fom>> FOM_LIST =
      new org.springframework.core.ParameterizedTypeReference<>() {};

  /** One FOM as returned by {@code GET {base-url}?fspId=…}. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Fom(String fomId, String name, String fspId, ForestClient forestClient) {

    /** The forest client (agreement holder) a FOM references. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ForestClient(String id, String name) {}
  }
}
