package ca.bc.gov.nrs.fsp.api.notification;

import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

/**
 * Tiny indirection between the workflow service and the email
 * dispatcher. Callers (currently just {@code WorkflowService})
 * publish a {@link WorkflowEmailEvent} here; the dispatcher's
 * {@code @TransactionalEventListener(AFTER_COMMIT)} picks it up
 * once the surrounding DB transaction commits — guaranteeing we
 * never send an email for a save that ended up rolling back.
 *
 * <p>Using Spring's {@link ApplicationEventPublisher} (rather than
 * calling the dispatcher directly) is what gives us the
 * transactional binding for free.
 */
@Service
@RequiredArgsConstructor
public class EmailNotificationService {

  private final ApplicationEventPublisher publisher;

  /** Publish an event for the current transaction's commit. */
  public void publish(WorkflowEmailEvent event) {
    publisher.publishEvent(event);
  }
}
