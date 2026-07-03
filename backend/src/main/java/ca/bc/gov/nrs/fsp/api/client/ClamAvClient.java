package ca.bc.gov.nrs.fsp.api.client;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Low-level client for a ClamAV {@code clamd} daemon spoken over raw TCP
 * (NOT HTTP) using the native {@code INSTREAM} socket protocol.
 *
 * <p>The wire exchange, per the clamd protocol:
 * <ol>
 *   <li>Send {@code zINSTREAM\0} — the {@code z} prefix selects
 *       null-terminated command framing.</li>
 *   <li>Stream the payload in chunks; each chunk is a 4-byte big-endian
 *       unsigned length followed by that many bytes.</li>
 *   <li>Terminate with a zero-length chunk ({@code writeInt(0)}).</li>
 *   <li>Read the reply up to the {@code 0x00} terminator, decode ASCII,
 *       and parse the {@code stream: ...} verdict.</li>
 * </ol>
 *
 * <p>This client <b>never throws to callers</b> — any {@link IOException}
 * or timeout is folded into a {@link ScanResult} with
 * {@link ScanResult.Status#ERROR}. The policy decision (fail-open vs
 * fail-closed) belongs to the layer above.
 */
@Component
public class ClamAvClient {

  private static final Logger LOG = LoggerFactory.getLogger(ClamAvClient.class);

  /** clamd command that opens an in-memory scan stream (null-framed). */
  private static final byte[] INSTREAM_COMMAND =
      "zINSTREAM\0".getBytes(StandardCharsets.US_ASCII);

  /** clamd liveness command (null-framed); a reachable daemon replies PONG. */
  private static final byte[] PING_COMMAND =
      "zPING\0".getBytes(StandardCharsets.US_ASCII);

  private final String host;
  private final int port;
  private final int connectTimeoutMillis;
  private final int readTimeoutMillis;
  private final int chunkSize;

  @Autowired
  ClamAvClient(
      @Value("${fsp.clamav.host:}") String host,
      @Value("${fsp.clamav.port:3310}") int port,
      @Value("${fsp.clamav.connect-timeout:5s}") Duration connectTimeout,
      @Value("${fsp.clamav.read-timeout:30s}") Duration readTimeout,
      @Value("${fsp.clamav.chunk-size:8192}") int chunkSize) {
    this(host, port,
        Math.toIntExact(connectTimeout.toMillis()),
        Math.toIntExact(readTimeout.toMillis()),
        chunkSize);
  }

  /**
   * Test / seam constructor — lets a unit test point the client at a
   * fake clamd on an arbitrary local port with tight timeouts.
   */
  ClamAvClient(
      String host, int port, int connectTimeoutMillis, int readTimeoutMillis, int chunkSize) {
    this.host = host;
    this.port = port;
    this.connectTimeoutMillis = connectTimeoutMillis;
    this.readTimeoutMillis = readTimeoutMillis;
    this.chunkSize = chunkSize > 0 ? chunkSize : 8192;
  }

  /**
   * Scan the given bytes against clamd. Returns a {@link ScanResult};
   * never throws. On any transport failure the result is
   * {@link ScanResult.Status#ERROR}.
   */
  public ScanResult scan(byte[] data) {
    byte[] payload = data == null ? new byte[0] : data;
    LOG.debug("clamav scan: streaming {} byte(s) to {}:{}", payload.length, host, port);
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(host, port), connectTimeoutMillis);
      socket.setSoTimeout(readTimeoutMillis);

      OutputStream rawOut = socket.getOutputStream();
      DataOutputStream out = new DataOutputStream(rawOut);
      out.write(INSTREAM_COMMAND);
      int offset = 0;
      while (offset < payload.length) {
        int len = Math.min(chunkSize, payload.length - offset);
        out.writeInt(len);
        out.write(payload, offset, len);
        offset += len;
      }
      // Zero-length chunk terminates the stream.
      out.writeInt(0);
      out.flush();

      String reply = readReply(socket.getInputStream());
      return parse(reply);
    } catch (IOException e) {
      LOG.warn("clamav scan ERROR contacting {}:{} — {}", host, port, e.getMessage());
      return ScanResult.error(e.getClass().getSimpleName() + ": " + e.getMessage());
    }
  }

  /**
   * Liveness check against clamd: opens a socket, sends {@code zPING\0}, and
   * returns true iff the daemon replies {@code PONG}. Never throws — any
   * transport failure (unreachable host, blocked route, timeout) returns
   * false. Used for the boot-time health log.
   */
  public boolean ping() {
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(host, port), connectTimeoutMillis);
      socket.setSoTimeout(readTimeoutMillis);
      OutputStream out = socket.getOutputStream();
      out.write(PING_COMMAND);
      out.flush();
      return "PONG".equals(readReply(socket.getInputStream()));
    } catch (IOException e) {
      LOG.warn("clamav PING failed contacting {}:{} — {}", host, port, e.getMessage());
      return false;
    }
  }

  /** Configured clamd host, for health/diagnostic logging. */
  public String host() {
    return host;
  }

  /** Configured clamd port, for health/diagnostic logging. */
  public int port() {
    return port;
  }

  /** Read bytes until the {@code 0x00} terminator (or EOF); ASCII-decode + trim. */
  private String readReply(InputStream in) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    int b;
    while ((b = in.read()) != -1) {
      if (b == 0) {
        break;
      }
      buf.write(b);
    }
    return buf.toString(StandardCharsets.US_ASCII).trim();
  }

  /**
   * Parse a clamd reply string into a {@link ScanResult}.
   *
   * <ul>
   *   <li>{@code ... OK} → CLEAN</li>
   *   <li>{@code stream: <sig> FOUND} → INFECTED (signature extracted)</li>
   *   <li>{@code ... ERROR} / empty / anything else → ERROR</li>
   * </ul>
   */
  static ScanResult parse(String reply) {
    if (reply == null || reply.isEmpty()) {
      return ScanResult.error("empty reply from clamd");
    }
    if (reply.contains("ERROR")) {
      return ScanResult.error(reply);
    }
    if (reply.endsWith("OK")) {
      return ScanResult.clean();
    }
    if (reply.endsWith("FOUND")) {
      String signature = extractSignature(reply);
      return ScanResult.infected(signature, reply);
    }
    return ScanResult.error("unrecognized reply from clamd: " + reply);
  }

  /**
   * Pull the signature token(s) out of a {@code stream: <sig> FOUND}
   * reply. Falls back to the whole reply if the expected framing is
   * absent.
   */
  private static String extractSignature(String reply) {
    String body = reply;
    int colon = body.indexOf(':');
    if (colon >= 0 && colon + 1 < body.length()) {
      body = body.substring(colon + 1);
    }
    body = body.trim();
    if (body.endsWith("FOUND")) {
      body = body.substring(0, body.length() - "FOUND".length()).trim();
    }
    return body.isEmpty() ? reply : body;
  }
}
