import { AddDocument } from '@carbon/pictograms-react';

// Empty-state pictogram for "add an attachment / add a document" panes —
// Carbon's AddDocument pictogram (@carbon/pictograms-react). Shared by the
// FSP AttachmentsTab and the stocking-standard attachments pane so both empty
// states show the same icon. The parent colours it via currentColor (the
// interactive blue), and it's rendered at the shared 48×48 empty-state size.
export const EmptyDocumentAddIcon = () => (
  <AddDocument width={48} height={48} />
);
