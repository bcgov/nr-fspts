package ca.bc.gov.nrs.fsp.api.notification;

import java.util.concurrent.Executor;
import javax.sql.DataSource;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Wires the email-notification module:
 *
 * <ul>
 *   <li>Turns on Spring's @Async support so
 *       {@code EmailEventDispatcher} can dispatch off the request thread.</li>
 *   <li>Defines {@code emailExecutor} — small 4-thread pool the dispatcher
 *       uses. Kept separate from the app's default scheduler so a slow
 *       SMTP response can't queue up against other async work.</li>
 *   <li>Activates ShedLock's {@code @SchedulerLock} support, backed by
 *       {@code THE.FSPTS_SHEDLOCK} (DDL lives in nr-mof-db). All FSP pods can
 *       enable the digest scheduler — ShedLock guarantees exactly one
 *       pod actually fires per cron tick.</li>
 * </ul>
 *
 * <p>SMTP transport itself is auto-configured by Spring Boot from the
 * {@code spring.mail.*} properties — see {@code application.properties}.
 *
 * <p>{@code defaultLockAtMostFor = PT30M}: the per-method
 * {@code @SchedulerLock(lockAtMostFor)} usually overrides this. The
 * default is a backstop so a crashed pod can't hold the lock forever —
 * after 30 minutes the lock auto-expires and another pod can claim it.
 */
@Configuration
@EnableAsync
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "PT30M")
@Slf4j
public class NotificationConfig {

  /**
   * Dedicated executor for {@code EmailEventDispatcher}. A small pool
   * is fine — SMTP sends are individually fast and email isn't on a
   * hot path. {@code CallerRunsPolicy} guarantees a burst (e.g. mass
   * approval) doesn't silently drop messages: if the pool is
   * saturated, the dispatching thread runs the task itself.
   */
  @Bean(name = "emailExecutor")
  public Executor emailExecutor() {
    var executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(50);
    executor.setThreadNamePrefix("email-");
    executor.setRejectedExecutionHandler(
        new java.util.concurrent.ThreadPoolExecutor.CallerRunsPolicy());
    executor.initialize();
    log.info("Initialized emailExecutor (core=2, max=4, queue=50)");
    return executor;
  }

  /**
   * JDBC-backed {@link LockProvider} pointing at {@code THE.FSPTS_SHEDLOCK}
   * (product-scoped name so the FSPTS lock rows don't collide with any
   * other tenant's ShedLock table in the shared schema). Always
   * registered (not conditional) because {@code @EnableSchedulerLock}
   * wires interceptors at startup that require this bean to exist even
   * when no {@code @SchedulerLock} method ends up running. Building the
   * bean is cheap — it just holds a {@link
   * org.springframework.jdbc.core.JdbcTemplate}; no connection is
   * opened until a lock is actually requested.
   *
   * <p>{@code usingDbTime} tells ShedLock to read the lock's "now"
   * timestamp from the database rather than the JVM clock — essential
   * when pods may have drifted clocks. Oracle returns
   * {@code SYSTIMESTAMP} via the lock provider's heartbeat.
   */
  @Bean
  public LockProvider designateBatchLockProvider(DataSource dataSource) {
    // usingDbTime() is mutually exclusive with withTimeZone() in
    // ShedLock 5.x — the DB clock is the source of truth, so the
    // JVM-side timezone would be meaningless. We pick usingDbTime
    // because it's the multi-pod-safe option: pod clock drift can't
    // grant a lock twice when LOCK_UNTIL is compared against
    // SYSTIMESTAMP on the database.
    return new JdbcTemplateLockProvider(
        JdbcTemplateLockProvider.Configuration.builder()
            .withJdbcTemplate(new org.springframework.jdbc.core.JdbcTemplate(dataSource))
            .withTableName("THE.FSPTS_SHEDLOCK")
            .withLockedByValue(System.getenv().getOrDefault("HOSTNAME", "fsp-backend"))
            .usingDbTime()
            .build());
  }
}
