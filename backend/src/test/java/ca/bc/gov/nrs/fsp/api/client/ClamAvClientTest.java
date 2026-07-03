package ca.bc.gov.nrs.fsp.api.client;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/**
 * Exercises {@link ClamAvClient} against an in-test fake clamd standing
 * on an ephemeral {@link ServerSocket}. The fake reassembles the
 * INSTREAM frames so the test can prove the wire protocol (command
 * bytes + length-prefixed chunking + zero terminator) is correct.
 */
class ClamAvClientTest {

  /**
   * A one-shot fake clamd: accepts a single connection, reads the
   * {@code zINSTREAM\0} command + length-prefixed chunks up to the
   * zero-length terminator, records the reassembled payload + the raw
   * command prefix, then writes back a canned reply.
   */
  private static final class FakeClamd implements AutoCloseable {
    final ServerSocket server;
    final Thread thread;
    final AtomicReference<byte[]> receivedPayload = new AtomicReference<>();
    final AtomicReference<String> receivedCommand = new AtomicReference<>();
    final CountDownLatch done = new CountDownLatch(1);

    FakeClamd(String cannedReply) throws IOException {
      this.server = new ServerSocket(0);
      this.thread = new Thread(() -> run(cannedReply));
      this.thread.setDaemon(true);
      this.thread.start();
    }

    int port() {
      return server.getLocalPort();
    }

    private void run(String cannedReply) {
      try (Socket socket = server.accept()) {
        DataInputStream in = new DataInputStream(socket.getInputStream());
        // Read the "zINSTREAM\0" command (10 bytes).
        byte[] cmd = new byte[10];
        in.readFully(cmd);
        receivedCommand.set(new String(cmd, StandardCharsets.US_ASCII));

        ByteArrayOutputStream payload = new ByteArrayOutputStream();
        while (true) {
          int len = in.readInt();
          if (len == 0) {
            break; // terminating zero-length chunk
          }
          byte[] chunk = new byte[len];
          in.readFully(chunk);
          payload.write(chunk);
        }
        receivedPayload.set(payload.toByteArray());

        OutputStream out = socket.getOutputStream();
        out.write(cannedReply.getBytes(StandardCharsets.US_ASCII));
        out.write(0); // null terminator
        out.flush();
      } catch (IOException e) {
        // swallow — test asserts on client-side result
      } finally {
        done.countDown();
      }
    }

    void awaitDone() throws InterruptedException {
      done.await(5, TimeUnit.SECONDS);
    }

    @Override
    public void close() throws IOException {
      server.close();
    }
  }

  @Test
  void clean_reply_yields_CLEAN() throws Exception {
    try (FakeClamd fake = new FakeClamd("stream: OK")) {
      ClamAvClient client = new ClamAvClient("127.0.0.1", fake.port(), 2000, 2000, 8192);
      ScanResult result = client.scan("hello world".getBytes(StandardCharsets.UTF_8));
      assertThat(result.status()).isEqualTo(ScanResult.Status.CLEAN);
    }
  }

  @Test
  void infected_reply_yields_INFECTED_with_signature() throws Exception {
    try (FakeClamd fake = new FakeClamd("stream: Eicar-Test-Signature FOUND")) {
      ClamAvClient client = new ClamAvClient("127.0.0.1", fake.port(), 2000, 2000, 8192);
      ScanResult result = client.scan("infected".getBytes(StandardCharsets.UTF_8));
      assertThat(result.status()).isEqualTo(ScanResult.Status.INFECTED);
      assertThat(result.signature()).isEqualTo("Eicar-Test-Signature");
    }
  }

  @Test
  void error_reply_yields_ERROR() throws Exception {
    try (FakeClamd fake = new FakeClamd("INSTREAM size limit exceeded. ERROR")) {
      ClamAvClient client = new ClamAvClient("127.0.0.1", fake.port(), 2000, 2000, 8192);
      ScanResult result = client.scan("too big".getBytes(StandardCharsets.UTF_8));
      assertThat(result.status()).isEqualTo(ScanResult.Status.ERROR);
    }
  }

  @Test
  void server_receives_correct_command_and_reassembled_payload() throws Exception {
    // A payload larger than the chunk size proves the client splits it
    // into multiple length-prefixed frames that the server reassembles
    // back to the original bytes.
    byte[] input = new byte[8192 * 2 + 123];
    for (int i = 0; i < input.length; i++) {
      input[i] = (byte) (i % 251);
    }
    try (FakeClamd fake = new FakeClamd("stream: OK")) {
      // chunkSize=8192 so the payload spans 3 chunks.
      ClamAvClient client = new ClamAvClient("127.0.0.1", fake.port(), 2000, 2000, 8192);
      ScanResult result = client.scan(input);
      fake.awaitDone();

      assertThat(result.status()).isEqualTo(ScanResult.Status.CLEAN);
      assertThat(fake.receivedCommand.get()).isEqualTo("zINSTREAM\0");
      assertThat(fake.receivedPayload.get()).isEqualTo(input);
    }
  }

  @Test
  void dead_port_yields_ERROR() throws Exception {
    // Bind then immediately close to obtain a port nothing listens on.
    int deadPort;
    try (ServerSocket tmp = new ServerSocket(0)) {
      deadPort = tmp.getLocalPort();
    }
    ClamAvClient client = new ClamAvClient("127.0.0.1", deadPort, 1000, 1000, 8192);
    ScanResult result = client.scan("data".getBytes(StandardCharsets.UTF_8));
    assertThat(result.status()).isEqualTo(ScanResult.Status.ERROR);
  }

  @Test
  void server_that_closes_early_yields_ERROR() throws Exception {
    try (ServerSocket server = new ServerSocket(0)) {
      Thread t = new Thread(() -> {
        try (Socket s = server.accept()) {
          // Read a byte then slam the connection shut before replying.
          InputStream in = s.getInputStream();
          in.read();
        } catch (IOException ignored) {
          // expected
        }
      });
      t.setDaemon(true);
      t.start();

      ClamAvClient client = new ClamAvClient("127.0.0.1", server.getLocalPort(), 1000, 1000, 8192);
      ScanResult result = client.scan("data".getBytes(StandardCharsets.UTF_8));
      assertThat(result.status()).isEqualTo(ScanResult.Status.ERROR);
    }
  }
}
