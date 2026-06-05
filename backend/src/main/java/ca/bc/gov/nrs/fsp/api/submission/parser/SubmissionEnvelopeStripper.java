package ca.bc.gov.nrs.fsp.api.submission.parser;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerConfigurationException;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

/**
 * Accepts either a bare {@code <fsp:fspSubmission>} document (the new
 * direct-upload format) or a legacy {@code <esf:ESFSubmission>} envelope
 * (what the old MOF_QUEUES.ESF_STATUS_Q pulled off Oracle ESF) and
 * returns bytes representing just the inner FSP submission. Downstream
 * validators see the same shape either way.
 */
@Component
@Slf4j
public class SubmissionEnvelopeStripper {

  public static final String ESF_NAMESPACE = "http://www.for.gov.bc.ca/schema/esf";
  public static final String FSP_NAMESPACE = "http://www.for.gov.bc.ca/schema/fsp";

  private static final String ESF_ROOT = "ESFSubmission";
  private static final String ESF_CONTENT = "submissionContent";
  private static final String FSP_ROOT = "fspSubmission";

  /**
   * @return the bytes of the inner {@code <fsp:fspSubmission>} subtree.
   * @throws SubmissionEnvelopeException if the document root is neither
   *     ESF nor FSP, or the ESF envelope doesn't contain an FSP body.
   */
  public byte[] toBareFspSubmission(byte[] raw) throws SubmissionEnvelopeException {
    RootKind kind;
    try {
      kind = detectRoot(raw);
    } catch (XMLStreamException e) {
      throw new SubmissionEnvelopeException(
          "ENVELOPE_PARSE_ERROR",
          "could not read XML to detect root element: " + e.getMessage(),
          e);
    }

    return switch (kind) {
      case FSP -> raw; // already in the right shape
      case ESF -> extractInner(raw);
      case UNKNOWN -> throw new SubmissionEnvelopeException(
          "ENVELOPE_UNRECOGNIZED",
          "root element must be {" + ESF_NAMESPACE + "}ESFSubmission or {"
              + FSP_NAMESPACE + "}fspSubmission");
    };
  }

  // ── XXE-hardened factory helpers ─────────────────────────────────────
  // Submissions are arbitrary user-uploaded XML, so every parser we
  // instantiate against them must explicitly disable DTDs, external
  // entities, XInclude, and external DTD/stylesheet resolution.
  // CodeQL's "Resolving XML external entity in user-controlled data"
  // rule flags any unguarded factory in this code path.

  private static XMLInputFactory newSecureXmlInputFactory() {
    XMLInputFactory factory = XMLInputFactory.newDefaultFactory();
    factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
    factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
    return factory;
  }

  private static DocumentBuilderFactory newSecureDocumentBuilderFactory()
      throws ParserConfigurationException {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
    factory.setXIncludeAware(false);
    factory.setExpandEntityReferences(false);
    return factory;
  }

  private static TransformerFactory newSecureTransformerFactory()
      throws TransformerConfigurationException {
    TransformerFactory factory = TransformerFactory.newInstance();
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
    return factory;
  }

  private RootKind detectRoot(byte[] raw) throws XMLStreamException {
    XMLInputFactory factory = newSecureXmlInputFactory();
    XMLStreamReader reader = factory.createXMLStreamReader(new ByteArrayInputStream(raw));
    try {
      while (reader.hasNext()) {
        if (reader.next() == XMLStreamConstants.START_ELEMENT) {
          String ns = reader.getNamespaceURI() == null ? "" : reader.getNamespaceURI();
          String local = reader.getLocalName();
          if (FSP_NAMESPACE.equals(ns) && FSP_ROOT.equals(local)) {
            return RootKind.FSP;
          }
          if (ESF_NAMESPACE.equals(ns) && ESF_ROOT.equals(local)) {
            return RootKind.ESF;
          }
          return RootKind.UNKNOWN;
        }
      }
      return RootKind.UNKNOWN;
    } finally {
      reader.close();
    }
  }

  private byte[] extractInner(byte[] raw) throws SubmissionEnvelopeException {
    try {
      DocumentBuilder db = newSecureDocumentBuilderFactory().newDocumentBuilder();
      Document doc = db.parse(new ByteArrayInputStream(raw));

      NodeList contents = doc.getElementsByTagNameNS(ESF_NAMESPACE, ESF_CONTENT);
      if (contents.getLength() == 0) {
        throw new SubmissionEnvelopeException(
            "ENVELOPE_MISSING_CONTENT",
            "<esf:ESFSubmission> has no <esf:submissionContent> child");
      }
      NodeList children = contents.item(0).getChildNodes();
      Element fsp = null;
      for (int i = 0; i < children.getLength(); i++) {
        if (children.item(i) instanceof Element el
            && FSP_NAMESPACE.equals(el.getNamespaceURI())
            && FSP_ROOT.equals(el.getLocalName())) {
          fsp = el;
          break;
        }
      }
      if (fsp == null) {
        throw new SubmissionEnvelopeException(
            "ENVELOPE_NOT_FSP",
            "<esf:submissionContent> does not wrap an <fsp:fspSubmission> element");
      }

      ByteArrayOutputStream out = new ByteArrayOutputStream();
      Transformer transformer = newSecureTransformerFactory().newTransformer();
      transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no");
      transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
      transformer.transform(new DOMSource(fsp), new StreamResult(out));
      return out.toByteArray();

    } catch (ParserConfigurationException | SAXException | IOException | TransformerException e) {
      throw new SubmissionEnvelopeException(
          "ENVELOPE_EXTRACTION_FAILED",
          "could not extract fsp:fspSubmission from ESF envelope: " + e.getMessage(),
          e);
    }
  }

  private enum RootKind { ESF, FSP, UNKNOWN }
}
