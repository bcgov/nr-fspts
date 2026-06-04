package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.w3c.dom.ls.LSInput;
import org.w3c.dom.ls.LSResourceResolver;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Compiles the vendored MOF + GML-2.12 XSD bundle once at startup
 * and exposes XML validation against it. The bundle ships with the
 * jar under {@code resources/schemas/fsp/}.
 */
@Component
@Slf4j
public class SchemaValidator {

  private static final String SCHEMA_ROOT = "schemas/fsp/";
  private static final String FSP_XSD = SCHEMA_ROOT + "MOF/mof-fsp.xsd";

  private Schema schema;

  /**
   * Apache feature toggle for the XSD 1.0 "fullSchemaChecking" pass —
   * the same set of cos-particle-restrict / derivation-ok-restriction
   * rules that the legacy MOF + GML-2.12 schemas violate. The runtime
   * validation we actually want (does an instance document satisfy
   * the content model) runs independently of this flag, so disabling
   * it lets the bundle compile without dropping any real checks.
   */
  private static final String FEATURE_SCHEMA_FULL_CHECKING =
      "http://apache.org/xml/features/validation/schema-full-checking";

  @PostConstruct
  void compileSchema() {
    try {
      SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
      try {
        factory.setFeature(FEATURE_SCHEMA_FULL_CHECKING, false);
      } catch (Exception featureFail) {
        log.debug("SchemaFactory does not honour {}; will rely on default settings",
            FEATURE_SCHEMA_FULL_CHECKING, featureFail);
      }
      factory.setResourceResolver(new ClasspathLsResolver());
      try (InputStream in = openClasspath(FSP_XSD)) {
        this.schema = factory.newSchema(new StreamSource(in, FSP_XSD));
      }
      log.info("FSP submission schema compiled from {}", FSP_XSD);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to compile FSP submission schema bundle", e);
    }
  }

  public Schema getSchema() {
    return schema;
  }

  /** Validate raw XML bytes against the schema. Returns collected errors. */
  public List<SubmissionValidationError> validate(byte[] xml) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    Validator validator = schema.newValidator();
    validator.setErrorHandler(new CollectingErrorHandler(errors));
    try {
      validator.validate(new StreamSource(new ByteArrayInputStream(xml)));
    } catch (SAXException e) {
      // Already captured by the error handler unless it was a fatal pre-parse
      // problem (e.g. malformed XML before the first element).
      if (errors.isEmpty()) {
        errors.add(SubmissionValidationError.of("XML_PARSE", e.getMessage()));
      }
    } catch (IOException e) {
      errors.add(SubmissionValidationError.of("XML_READ", e.getMessage()));
    }
    return errors;
  }

  private static InputStream openClasspath(String path) throws IOException {
    return new ClassPathResource(path).getInputStream();
  }

  /**
   * Resolves {@code <xs:import schemaLocation="mof-base.xsd"/>} and friends
   * against sibling files inside the vendored bundle.
   */
  private static final class ClasspathLsResolver implements LSResourceResolver {
    @Override
    public LSInput resolveResource(
        String type, String namespaceURI, String publicId, String systemId, String baseURI) {
      if (systemId == null) {
        return null;
      }
      String resolved = resolveAgainstBase(systemId, baseURI);
      try {
        InputStream stream = openClasspath(resolved);
        return new ClasspathLsInput(publicId, systemId, baseURI, stream);
      } catch (IOException e) {
        log.warn("Schema resource not found on classpath: {} (base={})", resolved, baseURI);
        return null;
      }
    }

    private String resolveAgainstBase(String systemId, String baseURI) {
      if (systemId.startsWith(SCHEMA_ROOT)) {
        return systemId;
      }
      String basePath = SCHEMA_ROOT;
      if (baseURI != null) {
        int idx = baseURI.indexOf(SCHEMA_ROOT);
        if (idx >= 0) {
          String tail = baseURI.substring(idx);
          int slash = tail.lastIndexOf('/');
          basePath = slash > 0 ? tail.substring(0, slash + 1) : SCHEMA_ROOT;
        }
      }
      return normalize(basePath + systemId);
    }

    /** Collapses "foo/../bar" segments produced by relative imports. */
    private String normalize(String path) {
      String[] parts = path.split("/");
      java.util.Deque<String> stack = new java.util.ArrayDeque<>();
      for (String p : parts) {
        if (p.isEmpty() || ".".equals(p)) {
          continue;
        }
        if ("..".equals(p)) {
          if (!stack.isEmpty()) {
            stack.removeLast();
          }
          continue;
        }
        stack.addLast(p);
      }
      return String.join("/", stack);
    }
  }

  private static final class ClasspathLsInput implements LSInput {
    private final String publicId;
    private final String systemId;
    private final String baseURI;
    private InputStream byteStream;

    ClasspathLsInput(String publicId, String systemId, String baseURI, InputStream byteStream) {
      this.publicId = publicId;
      this.systemId = systemId;
      this.baseURI = baseURI;
      this.byteStream = byteStream;
    }

    @Override public InputStream getByteStream() { return byteStream; }
    @Override public void setByteStream(InputStream byteStream) { this.byteStream = byteStream; }
    @Override public String getPublicId() { return publicId; }
    @Override public void setPublicId(String publicId) { /* immutable */ }
    @Override public String getSystemId() { return systemId; }
    @Override public void setSystemId(String systemId) { /* immutable */ }
    @Override public String getBaseURI() { return baseURI; }
    @Override public void setBaseURI(String baseURI) { /* immutable */ }
    @Override public java.io.Reader getCharacterStream() { return null; }
    @Override public void setCharacterStream(java.io.Reader characterStream) { }
    @Override public String getStringData() { return null; }
    @Override public void setStringData(String stringData) { }
    @Override public String getEncoding() { return null; }
    @Override public void setEncoding(String encoding) { }
    @Override public boolean getCertifiedText() { return false; }
    @Override public void setCertifiedText(boolean certifiedText) { }
  }

  private static final class CollectingErrorHandler implements ErrorHandler {
    private final List<SubmissionValidationError> sink;

    CollectingErrorHandler(List<SubmissionValidationError> sink) {
      this.sink = sink;
    }

    @Override
    public void warning(SAXParseException e) {
      // Warnings don't fail submission; log only.
      log.debug("schema warning at {}:{} — {}", e.getLineNumber(), e.getColumnNumber(), e.getMessage());
    }

    @Override
    public void error(SAXParseException e) {
      sink.add(toError(e));
    }

    @Override
    public void fatalError(SAXParseException e) {
      sink.add(toError(e));
    }

    private SubmissionValidationError toError(SAXParseException e) {
      String location = String.format("line %d, col %d", e.getLineNumber(), e.getColumnNumber());
      return SubmissionValidationError.of(location, "XSD", e.getMessage());
    }
  }
}
