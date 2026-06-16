package ca.bc.gov.nrs.fsp.api.notification;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

/**
 * Minimal {@code {{name}}} substitution over a classpath text template.
 * Deliberately not Thymeleaf — these are short, text-only mails and a
 * named-placeholder fill is all they need.
 *
 * <p>Templates live under {@code classpath:notification/template/<name>.txt}.
 * Bodies are cached in memory after the first read — they don't change
 * at runtime, and re-reading on every send is wasted I/O.
 *
 * <p>Missing keys render as empty string. Unknown placeholders are
 * logged at WARN so a template / context drift doesn't silently
 * publish "Dear {{contactName}}" into a real email.
 */
@Component
@Slf4j
public class EmailTemplateRenderer {

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*(\\w+)\\s*}}");
  private static final String TEMPLATE_ROOT = "notification/template/";

  private final Map<String, String> cache = new ConcurrentHashMap<>();

  /**
   * Loads {@code templateName.txt} from the classpath and substitutes
   * every {@code {{key}}} occurrence with {@code context.get(key)}.
   *
   * @param templateName base name without extension (e.g. {@code "fsp_decision_email"}).
   * @param context substitution map. Null values render as empty.
   * @return the rendered body.
   * @throws IllegalStateException if the template can't be read.
   */
  public String render(String templateName, Map<String, String> context) {
    String body = cache.computeIfAbsent(templateName, this::loadFromClasspath);
    Matcher m = PLACEHOLDER.matcher(body);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String key = m.group(1);
      String value = context.get(key);
      if (value == null) {
        if (!context.containsKey(key)) {
          log.warn(
              "Email template {} references {{{}}} but the context didn't supply it — rendering empty",
              templateName, key);
        }
        value = "";
      }
      m.appendReplacement(sb, Matcher.quoteReplacement(value));
    }
    m.appendTail(sb);
    return sb.toString();
  }

  private String loadFromClasspath(String name) {
    String path = TEMPLATE_ROOT + name + ".txt";
    try (var in = new ClassPathResource(path).getInputStream()) {
      return StreamUtils.copyToString(in, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("Failed to load email template " + path, e);
    }
  }
}
