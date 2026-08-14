import { Button } from '@carbon/react';
import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import CreateFspModal from '@/components/CreateFspModal';
import { useNotification } from '@/context/notification/useNotification';
import './CreateFspPage.scss';

/**
 * Landing surface for the "Create FSP" nav entry.
 *
 * The feature is a dialog, but it hangs off a nav item — so it gets a route
 * rather than opening the modal straight from the side nav. That keeps the
 * URL shareable, gives the browser Back button something sane to do, and
 * leaves somewhere to stand when the dialog is dismissed. The modal opens
 * immediately on arrival; closing it reveals this page, from which it can be
 * reopened.
 */
const CreateFspPage: FC = () => {
  const navigate = useNavigate();
  const { display } = useNotification();
  const [open, setOpen] = useState(true);

  const handleCreated = (fspId: string) => {
    setOpen(false);
    display({
      kind: 'success',
      title: `FSP ${fspId} created`,
      subtitle: 'The plan has been created as a draft.',
      timeout: 5000,
    });
    navigate(`/fsp/information?fspId=${encodeURIComponent(fspId)}`);
  };

  return (
    <div className="fsp-create-page">
      <h1>Create FSP</h1>
      <p className="fsp-create__subtitle">
        Open a new Forest Stewardship Plan as a draft, then add stocking
        standards, FDUs and attachments to it.
      </p>
      <div className="fsp-create__actions">
        <Button kind="primary" onClick={() => setOpen(true)}>
          Create FSP
        </Button>
      </div>

      <CreateFspModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
};

export default CreateFspPage;
