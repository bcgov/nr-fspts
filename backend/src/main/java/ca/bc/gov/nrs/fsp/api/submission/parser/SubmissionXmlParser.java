package ca.bc.gov.nrs.fsp.api.submission.parser;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.validator.SchemaValidator;
import jakarta.annotation.PostConstruct;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBElement;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Unmarshaller;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Wraps the generated JAXB unmarshaller. Returns either a parsed
 * {@link FSPSubmissionType} or a list of validation errors collected
 * by the schema-aware event handler.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SubmissionXmlParser {

  private final SchemaValidator schemaValidator;

  private JAXBContext jaxbContext;

  @PostConstruct
  void initContext() {
    try {
      this.jaxbContext = JAXBContext.newInstance(FSPSubmissionType.class.getPackageName());
      log.info(
          "JAXB context initialized for {}", FSPSubmissionType.class.getPackageName());
    } catch (JAXBException e) {
      throw new IllegalStateException("Failed to initialize JAXB context for FSP submission", e);
    }
  }

  public ParseOutcome parse(byte[] xml) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    try {
      Unmarshaller unmarshaller = jaxbContext.createUnmarshaller();
      unmarshaller.setSchema(schemaValidator.getSchema());
      unmarshaller.setEventHandler(event -> {
        errors.add(
            SubmissionValidationError.of(
                event.getLocator() == null
                    ? null
                    : String.format(
                        "line %d, col %d",
                        event.getLocator().getLineNumber(),
                        event.getLocator().getColumnNumber()),
                "JAXB",
                event.getMessage()));
        return true; // continue collecting
      });

      XMLStreamReader reader =
          XMLInputFactory.newDefaultFactory().createXMLStreamReader(new ByteArrayInputStream(xml));
      Object root = unmarshaller.unmarshal(reader);
      FSPSubmissionType submission = extractSubmission(root);
      return new ParseOutcome(submission, errors);
    } catch (Exception e) {
      errors.add(SubmissionValidationError.of("XML_PARSE", e.getMessage()));
      return new ParseOutcome(null, errors);
    }
  }

  private FSPSubmissionType extractSubmission(Object root) {
    if (root instanceof JAXBElement<?> el && el.getValue() instanceof FSPSubmissionType s) {
      return s;
    }
    if (root instanceof FSPSubmissionType s) {
      return s;
    }
    return null;
  }

  public record ParseOutcome(FSPSubmissionType submission, List<SubmissionValidationError> errors) {
    public boolean ok() {
      return submission != null && errors.isEmpty();
    }
  }
}
