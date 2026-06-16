package ca.bc.gov.nrs.fsp.api;

import lombok.val;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.annotation.EnableRetry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/**
 * The type School api resource application.
 */
@SpringBootApplication
@EnableCaching
@EnableRetry
public class FspApiResourceApplication {
  /**
   * The entry point of application.
   *
   * @param args the input arguments
   */
  public static void main(String[] args) {
    SpringApplication.run(FspApiResourceApplication.class, args);
  }

  /**
   * Thread pool task scheduler thread pool task scheduler.
   *
   * @return the thread pool task scheduler
   */
  @Bean
  public ThreadPoolTaskScheduler threadPoolTaskScheduler() {
    val threadPoolTaskScheduler = new ThreadPoolTaskScheduler();
    threadPoolTaskScheduler.setPoolSize(5);
    return threadPoolTaskScheduler;
  }

  /**
   * The type Web security configuration. Add security exceptions for swagger UI and prometheus.
   */
  @Configuration
  @EnableMethodSecurity
  static
  class WebSecurityConfiguration {

    /**
     * Instantiates a new Web security configuration. This makes sure that security context is
     * propagated to async threads as well.
     */
    public WebSecurityConfiguration() {
      super();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
      http
              .csrf(AbstractHttpConfigurer::disable)
              .authorizeHttpRequests(auth -> auth
                      .requestMatchers("/v3/api-docs/**",
                              "/actuator/health", "/actuator/prometheus", "/actuator/**",
                              "/swagger-ui/**").permitAll()
                      .anyRequest().authenticated()
              )
              .sessionManagement(sess -> sess.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
              .oauth2ResourceServer(oauth2 -> oauth2
                      .jwt(Customizer.withDefaults())
              );
      return http.build();
    }
  }

}
