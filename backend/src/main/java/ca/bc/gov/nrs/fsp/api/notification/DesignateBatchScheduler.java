package ca.bc.gov.nrs.fsp.api.notification;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Cron trigger for {@link DesignateBatchService#runOnce()}. Conditional
 * on {@code fsp.notification.designate.enabled=true}, which all FSP
 * pods should set in production — the {@link SchedulerLock} guarantees
 * exactly one pod actually runs the digest per firing, even when N
 * replicas are up.
 *
 * <p>Cron expression and time zone are configurable via
 * {@code fsp.notification.designate.cron} (6-field Spring cron;
 * default {@code "0 0 2 * * *"} = 02:00 daily) and
 * {@code fsp.notification.designate.zone} (default
 * {@code America/Vancouver}).
 *
 * <p>Lock semantics:
 * <ul>
 *   <li>{@code lockAtMostFor = PT29M} — backstop expiry. If a pod
 *       crashes mid-run, the lock auto-releases after 29 minutes and
 *       another pod can retry on the next cron tick. Shorter than the
 *       default 30 m in {@code @EnableSchedulerLock} so the next
 *       02:00 firing isn't gated by the prior one's backstop.</li>
 *   <li>{@code lockAtLeastFor = PT2M} — minimum lock hold even if the
 *       run finishes quickly. Prevents clock-skew between pods from
 *       letting two of them both fire at 02:00:00 ±1s and both
 *       deciding the queue was empty.</li>
 * </ul>
 */
@Component
@ConditionalOnProperty(
    prefix = "fsp.notification.designate",
    name = "enabled",
    havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class DesignateBatchScheduler {

  private static final String LOCK_NAME = "designateBatch";

  private final DesignateBatchService service;
  private final JdbcTemplate jdbcTemplate;

  @Scheduled(
      cron = "${fsp.notification.designate.cron}",
      zone = "${fsp.notification.designate.zone}")
  @SchedulerLock(
      name = LOCK_NAME,
      lockAtMostFor = "PT29M",
      lockAtLeastFor = "PT2M")
  public void runScheduled() {
    log.info("Designate batch trigger firing (lock acquired on this pod)");
    // Echo the actual SHEDLOCK row state right after acquisition so we
    // can confirm — without dropping into sqlplus — that ShedLock is
    // touching THE.FSPTS_SHEDLOCK and that the values look sane.
    // Temporary observability for the OpenShift 3-pod test; safe to
    // keep once verified (one cheap SELECT per cron tick).
    logShedLockRow();
    try {
      service.runOnce();
    } catch (RuntimeException ex) {
      // Don't let one bad run kill the next scheduled trigger — @Scheduled
      // skips subsequent firings if the method propagates.
      log.error("Designate batch run threw — will retry on next cron tick", ex);
    }
  }

  private void logShedLockRow() {
    try {
      jdbcTemplate.query(
          "SELECT name, lock_until, locked_at, locked_by "
              + "FROM the.fspts_shedlock WHERE name = ?",
          rs -> {
            log.info(
                "ShedLock row: name={} lock_until={} locked_at={} locked_by={}",
                rs.getString("name"),
                rs.getTimestamp("lock_until"),
                rs.getTimestamp("locked_at"),
                rs.getString("locked_by"));
          },
          LOCK_NAME);
    } catch (EmptyResultDataAccessException e) {
      log.warn("ShedLock row for '{}' not found right after acquisition — "
          + "ShedLock may not have written the row; check schema/grants.",
          LOCK_NAME);
    } catch (RuntimeException e) {
      log.warn("ShedLock row lookup failed: {}", e.getMessage());
    }
  }
}
