package ca.bc.gov.nrs.fsp.api.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AttachmentConstraintsTest {

  private static final long OK_SIZE = 1024L;

  @Test
  void accepts_a_plain_ascii_name_at_the_limit() {
    // Exactly 50 ASCII chars = exactly 50 bytes — the boundary must pass.
    String name = "a".repeat(46) + ".pdf";
    assertThat(name).hasSize(50);
    assertThatCode(() -> AttachmentConstraints.validate(name, OK_SIZE))
        .doesNotThrowAnyException();
  }

  @Test
  void rejects_a_plain_ascii_name_one_over_the_limit() {
    String name = "a".repeat(47) + ".pdf";
    assertThat(name).hasSize(51);
    assertThatThrownBy(() -> AttachmentConstraints.validate(name, OK_SIZE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("File name too long");
  }

  /**
   * The reported production defect: an en-dash (U+2013) is 1 character but
   * 3 UTF-8 bytes, so this name is 50 "characters" and 52 bytes. Counting
   * characters let it past validation and into an ORA-12899 on insert.
   */
  @Test
  void rejects_a_name_within_the_char_limit_but_over_the_byte_limit() {
    String name = "FSP_Extension_Request_–_Supporting_Letter_2026.pdf";
    assertThat(name.length()).isEqualTo(50);
    assertThat(AttachmentConstraints.filenameByteLength(name)).isEqualTo(52);

    assertThatThrownBy(() -> AttachmentConstraints.validate(name, OK_SIZE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("File name too long")
        // The message must explain the discrepancy, or a user who just
        // counted 50 characters has no idea what to change.
        .hasMessageContaining("2-3");
  }

  @Test
  void counts_accented_letters_as_two_bytes() {
    assertThat(AttachmentConstraints.filenameByteLength("café.pdf")).isEqualTo(9);
    assertThat("café.pdf".length()).isEqualTo(8);
  }

  @Test
  void rejects_unsupported_extension_before_length() {
    // A name failing both rules reports the type first, matching the
    // frontend's ordering.
    String name = "x".repeat(60) + ".exe";
    assertThatThrownBy(() -> AttachmentConstraints.validate(name, OK_SIZE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("File type not supported");
  }

  @Test
  void rejects_an_oversized_file() {
    assertThatThrownBy(() ->
        AttachmentConstraints.validate("ok.pdf", AttachmentConstraints.MAX_ATTACHMENT_BYTES + 1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("File exceeds size limit");
  }

  @Test
  void treats_a_null_name_as_an_unsupported_type_rather_than_throwing_npe() {
    assertThatThrownBy(() -> AttachmentConstraints.validate(null, OK_SIZE))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("File type not supported");
  }
}
