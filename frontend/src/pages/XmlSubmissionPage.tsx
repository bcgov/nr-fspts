import { useState } from 'react';
import { FileUploader, TextInput, Button, InlineNotification } from '@carbon/react';
import { Upload } from '@carbon/react/icons';
import PageLayout from './PageLayout';
import './PageLayout.css';

export default function XmlSubmissionPage() {
  const [fspId,    setFspId]    = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <PageLayout title="XML Submission">

      <div className="form-section">
        <div className="form-section__title">FSP Identification</div>
        <div style={{ maxWidth: 300 }}>
          <TextInput
            id="fspId"
            labelText="FSP ID"
            value={fspId}
            onChange={e => setFspId(e.target.value)}
            maxLength={10}
          />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">Upload XML / GML File</div>
        <p style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '1rem' }}>
          Submit your Forest Stewardship Plan as an XML or GML file. The file will be
          validated against the FSP schema before processing.
        </p>
        <FileUploader
          labelTitle="Select file"
          labelDescription="Accepted formats: .xml, .gml. Max size: 50 MB."
          buttonLabel="Add file"
          accept={['.xml', '.gml']}
          filenameStatus="edit"
        />
      </div>

      {submitted && (
        <InlineNotification
          kind="success"
          title="Submission received."
          subtitle="Your XML file has been queued for processing."
          style={{ marginBottom: '1rem' }}
        />
      )}

      <div className="form-actions">
        <Button kind="primary" renderIcon={Upload} onClick={() => setSubmitted(true)}>Submit</Button>
        <Button kind="secondary" onClick={() => setSubmitted(false)}>Clear</Button>
      </div>
    </PageLayout>
  );
}
