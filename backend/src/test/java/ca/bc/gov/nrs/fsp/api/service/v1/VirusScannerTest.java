package ca.bc.gov.nrs.fsp.api.service.v1;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ca.bc.gov.nrs.fsp.api.client.ClamAvClient;
import ca.bc.gov.nrs.fsp.api.client.ScanResult;
import ca.bc.gov.nrs.fsp.api.exception.VirusDetectedException;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class VirusScannerTest {

  private static final byte[] DATA = "payload".getBytes();

  private ClamAvClient client() {
    return mock(ClamAvClient.class);
  }

  @Test
  void disabled_never_scans_and_returns_empty() {
    ClamAvClient client = client();
    VirusScanner scanner = new VirusScanner(client, /*enabled=*/ false, /*failOpen=*/ false);

    Optional<VirusScanner.Rejection> result = scanner.check(DATA, "f.pdf");

    assertThat(result).isEmpty();
    verify(client, never()).scan(any());
  }

  @Test
  void clean_returns_empty() {
    ClamAvClient client = client();
    when(client.scan(any())).thenReturn(ScanResult.clean());
    VirusScanner scanner = new VirusScanner(client, true, false);

    assertThat(scanner.check(DATA, "f.pdf")).isEmpty();
  }

  @Test
  void infected_returns_VIRUS_DETECTED_rejection() {
    ClamAvClient client = client();
    when(client.scan(any())).thenReturn(
        ScanResult.infected("Eicar-Test-Signature", "stream: Eicar-Test-Signature FOUND"));
    VirusScanner scanner = new VirusScanner(client, true, false);

    Optional<VirusScanner.Rejection> result = scanner.check(DATA, "f.pdf");

    assertThat(result).isPresent();
    assertThat(result.get().code()).isEqualTo(VirusScanner.CODE_VIRUS_DETECTED);
    assertThat(result.get().message()).contains("Eicar-Test-Signature");
  }

  @Test
  void error_fail_closed_returns_SCAN_UNAVAILABLE() {
    ClamAvClient client = client();
    when(client.scan(any())).thenReturn(ScanResult.error("connection refused"));
    VirusScanner scanner = new VirusScanner(client, /*enabled=*/ true, /*failOpen=*/ false);

    Optional<VirusScanner.Rejection> result = scanner.check(DATA, "f.pdf");

    assertThat(result).isPresent();
    assertThat(result.get().code()).isEqualTo(VirusScanner.CODE_SCAN_UNAVAILABLE);
  }

  @Test
  void error_fail_open_returns_empty() {
    ClamAvClient client = client();
    when(client.scan(any())).thenReturn(ScanResult.error("timeout"));
    VirusScanner scanner = new VirusScanner(client, /*enabled=*/ true, /*failOpen=*/ true);

    assertThat(scanner.check(DATA, "f.pdf")).isEmpty();
  }

  @Test
  void scanOrThrow_throws_on_rejection() {
    ClamAvClient client = client();
    when(client.scan(any())).thenReturn(
        ScanResult.infected("Win.Test.EICAR_HDB-1", "stream: Win.Test.EICAR_HDB-1 FOUND"));
    VirusScanner scanner = new VirusScanner(client, true, false);

    assertThatThrownBy(() -> scanner.scanOrThrow(DATA, "f.pdf"))
        .isInstanceOf(VirusDetectedException.class)
        .hasMessageContaining("Win.Test.EICAR_HDB-1");
  }

  @Test
  void scanOrThrow_silent_when_clean() {
    ClamAvClient client = client();
    when(client.scan(any())).thenReturn(ScanResult.clean());
    VirusScanner scanner = new VirusScanner(client, true, false);

    scanner.scanOrThrow(DATA, "f.pdf"); // no exception
  }
}
