package ca.bc.gov.nrs.fsp.api.notification;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Verifies the {@code fsp.mail.send-enabled} kill-switch on the workflow
 * email path: when off, the event is still processed (template rendered,
 * logged) but nothing hits the SMTP transport; when on, the mail is sent.
 */
@ExtendWith(MockitoExtension.class)
class EmailEventDispatcherTest {

  @Mock private JavaMailSender mailSender;
  @Mock private EmailTemplateRenderer renderer;
  @InjectMocks private EmailEventDispatcher dispatcher;

  private static WorkflowEmailEvent event() {
    return new WorkflowEmailEvent.FspDecision(
        new WorkflowEmailEvent.FspSnapshot(
            "123", "0", "Plan", "Approved", "Jane", "2026-01-01",
            "jane@example.com", "DCK", "0001", ""));
  }

  @Test
  void disabled_doesNotSend() {
    ReflectionTestUtils.setField(dispatcher, "sendEnabled", false);
    ReflectionTestUtils.setField(dispatcher, "fromAddress", "noreply@example.com");

    dispatcher.onWorkflowEmailEvent(event());

    verify(mailSender, never()).send(any(SimpleMailMessage.class));
  }

  @Test
  void enabled_sends() {
    ReflectionTestUtils.setField(dispatcher, "sendEnabled", true);
    ReflectionTestUtils.setField(dispatcher, "fromAddress", "noreply@example.com");
    when(renderer.render(anyString(), anyMap())).thenReturn("body");

    dispatcher.onWorkflowEmailEvent(event());

    verify(mailSender, times(1)).send(any(SimpleMailMessage.class));
  }
}
