package ca.bc.gov.nrs.fsp.api.config;

import ca.bc.gov.nrs.fsp.api.security.AuthorizedPartyValidator;
import ca.bc.gov.nrs.fsp.api.security.FsptsAuthoritiesConverter;
import ca.bc.gov.nrs.fsp.api.security.FsptsRoleValidator;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.security.oauth2.resource.OAuth2ResourceServerProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;

import java.net.MalformedURLException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.time.Duration;

/**
 * Security beans for the FSP API.
 *
 * <p>Authentication is against BC Gov SSO (Keycloak) access tokens from the
 * standard realm. On top of the standard signature, issuer and expiry checks:</p>
 * <ul>
 *   <li>{@link AuthorizedPartyValidator} — the token's {@code azp} must be FSP's
 *   own CSS client id. The realm is shared, so issuer + signature alone don't
 *   show a token was meant for FSP.</li>
 *   <li>{@link FsptsRoleValidator} — the token must carry at least one FSPTS
 *   role.</li>
 * </ul>
 *
 * <p>Authorities come from the token's FAM roles via
 * {@link FsptsAuthoritiesConverter}, collapsed to the single effective role.</p>
 */
@Configuration
@EnableMethodSecurity
public class FspSecurityConfig {

  @Bean
  public JwtDecoder jwtDecoder(
      OAuth2ResourceServerProperties properties,
      @Value("${fsp.keycloak.client-id}") String expectedClientId) {
    NimbusJwtDecoder decoder = buildJwtDecoder(properties.getJwt().getJwkSetUri());

    OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
        JwtValidators.createDefaultWithIssuer(properties.getJwt().getIssuerUri()),
        new AuthorizedPartyValidator(expectedClientId),
        new FsptsRoleValidator()
    );
    decoder.setJwtValidator(validator);
    return decoder;
  }

  @Bean
  public JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(new FsptsAuthoritiesConverter());
    return converter;
  }

  /**
   * A decoder whose signing keys are cached (refreshed ahead of expiry, with
   * retries and explicit timeouts) rather than fetched per request. Spring's
   * default builder doesn't cache, so a brief realm hiccup turns into
   * intermittent 401s. Same construction as nr-rept.
   */
  private static NimbusJwtDecoder buildJwtDecoder(String jwkSetUri) {
    URL jwkSetUrl;
    try {
      jwkSetUrl = new URI(jwkSetUri).toURL();
    } catch (URISyntaxException | MalformedURLException | IllegalArgumentException e) {
      throw new IllegalStateException("Invalid jwk-set-uri: " + jwkSetUri, e);
    }

    DefaultResourceRetriever retriever = new DefaultResourceRetriever(
        (int) Duration.ofSeconds(10).toMillis(),
        (int) Duration.ofSeconds(15).toMillis(),
        50 * 1024
    );

    JWKSource<SecurityContext> jwkSource = JWKSourceBuilder
        .create(jwkSetUrl, retriever)
        .retrying(true)
        .refreshAheadCache(true)
        .build();

    ConfigurableJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
    processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource));
    return new NimbusJwtDecoder(processor);
  }
}
