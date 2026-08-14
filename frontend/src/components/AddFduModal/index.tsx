import {
  Button,
  InlineLoading,
  InlineNotification,
  Tag,
  TextArea,
  TextInput,
} from '@carbon/react';
import { useEffect, useRef, useState, type FC } from 'react';

import { Modal } from '@/components/Modal';
import BoundaryExamples, {
  INSERTED_NOTICE,
  type BoundaryFormat,
} from './BoundaryExamples';
import { safeErrorMessage } from '@/lib/errorMessage';
import {
  addFdu,
  checkLicenceExists,
  type FduCreatedResult,
} from '@/services/fspSearch';
import './AddFduModal.scss';

/**
 * "Add FDU" dialog on the FDU/Map tab — name, boundary, optional licences.
 *
 * <p>The boundary is a paste field rather than a drawing tool: the people
 * filling this in already have the polygon in a GIS, and asking them to
 * re-draw it would lose precision the source file already has. Both GeoJSON
 * and WKT are accepted because which one you have to hand depends on the
 * export you ran.
 *
 * <p>Geometry is required. An FDU header with no boundary would still satisfy
 * the submit-time "FDUs modified" check, so allowing one here would let a plan
 * claim FDU changes with nothing spatial behind them.
 */
interface Props {
  open: boolean;
  fspId: string;
  amendmentNumber: string;
  onClose: () => void;
  /** Called after a successful add so the parent can refetch the list. */
  onAdded: (result: FduCreatedResult) => void;
}

/** FOREST_DEVELOPMENT_UNIT.FDU_NAME is VARCHAR2(120). */
const MAX_FDU_NAME = 120;

const AddFduModal: FC<Props> = ({
  open,
  fspId,
  amendmentNumber,
  onClose,
  onAdded,
}) => {
  const [fduName, setFduName] = useState('');
  const [geometry, setGeometry] = useState('');
  const [licenceInput, setLicenceInput] = useState('');
  const [licences, setLicences] = useState<string[]>([]);
  const [licenceChecking, setLicenceChecking] = useState(false);
  const [licenceError, setLicenceError] = useState('');
  const [nameError, setNameError] = useState('');
  const [geometryError, setGeometryError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * What was just inserted into the Boundary field, if anything.
   *
   * <p>Instruction rather than confirmation - it tells someone the field now
   * holds sample coordinates they are expected to replace - so it does not
   * time out. A second insert replaces it rather than stacking a second
   * message about a field that only holds one value.
   */
  const [insertedNotice, setInsertedNotice] = useState<
    { title: string; body: string } | null
  >(null);

  const geometryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setFduName('');
    setGeometry('');
    setLicenceInput('');
    setLicences([]);
    setLicenceError('');
    setNameError('');
    setGeometryError('');
    setSubmitError('');
  }, [open]);

  const addLicence = async () => {
    const id = licenceInput.trim().toUpperCase();
    if (!id) return;
    if (licences.includes(id)) {
      setLicenceError(`${id} is already on this FDU.`);
      return;
    }
    // Check before adding the chip, so an unknown number is caught here
    // rather than rejecting the whole save later.
    setLicenceChecking(true);
    setLicenceError('');
    try {
      // checkLicenceExists resolves to a plain boolean, not a { exists }
      // object — the same call the Edit-licences dialog makes.
      const exists = await checkLicenceExists(fspId, id);
      if (!exists) {
        setLicenceError(`${id} isn’t a known forest-use licence number.`);
        return;
      }
      setLicences((prev) => [...prev, id]);
      setLicenceInput('');
    } catch {
      setLicenceError('Could not check that licence number. Try again.');
    } finally {
      setLicenceChecking(false);
    }
  };

  const validate = (): boolean => {
    let ok = true;
    const name = fduName.trim();
    if (!name) {
      setNameError('FDU name is required.');
      ok = false;
    } else if (name.length > MAX_FDU_NAME) {
      setNameError(`Maximum ${MAX_FDU_NAME} characters.`);
      ok = false;
    } else {
      setNameError('');
    }
    if (!geometry.trim()) {
      setGeometryError('A boundary is required.');
      ok = false;
    } else {
      setGeometryError('');
    }
    return ok;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    setSubmitError('');
    try {
      const result = await addFdu(fspId, amendmentNumber, {
        fduName: fduName.trim(),
        geometry: geometry.trim(),
        licenceNumbers: licences,
      });
      onAdded(result);
    } catch (e) {
      // The server's geometry messages are written for this field, so they
      // land beside it rather than in the generic banner.
      const message = safeErrorMessage(
        e instanceof Error ? e.message : '',
        'The FDU could not be added. Please try again.',
      );
      if (/boundary|polygon|ring|coordinate|geojson|wkt|epsg|json/i.test(message)) {
        setGeometryError(message);
      } else {
        setSubmitError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onRequestClose={saving ? undefined : onClose}
      modalHeading="Add Forest Development Unit"
      // passiveModal + our own action row — see CreateFspModal.
      passiveModal
      className="fsp-species-modal"
      size="md"
      preventCloseOnClickOutside
    >
      <p className="add-fdu__intro">
        Give the unit a name and paste its boundary. The boundary is checked
        and measured when you add it.
      </p>

      {submitError && (
        <div className="add-fdu__error" role="alert">
          {submitError}
        </div>
      )}

      <div className="add-fdu__field">
        <TextInput
          id="add-fdu-name"
          labelText="FDU name"
          value={fduName}
          maxLength={MAX_FDU_NAME}
          invalid={!!nameError}
          invalidText={nameError}
          disabled={saving}
          onChange={(e) => {
            setFduName(e.target.value);
            setNameError('');
          }}
        />
      </div>

      {insertedNotice && (
        <InlineNotification
          className="add-fdu__inserted"
          kind="info"
          lowContrast
          role="status"
          title={insertedNotice.title}
          subtitle={insertedNotice.body}
          onClose={() => {
            setInsertedNotice(null);
            // Carbon would otherwise close its own copy of the notification
            // and leave ours rendered.
            return false;
          }}
        />
      )}

      <div className="add-fdu__field">
        <TextArea
          id="add-fdu-geometry"
          ref={geometryRef}
          labelText="Boundary"
          placeholder="Paste your boundary here"
          helperText={
            'Paste GeoJSON (a Polygon, a MultiPolygon, a Feature, or a '
            + 'one-feature FeatureCollection) or WKT. BC Albers (EPSG:3005) is '
            + 'assumed unless the GeoJSON names a different one.'
          }
          rows={8}
          value={geometry}
          invalid={!!geometryError}
          invalidText={geometryError}
          disabled={saving}
          onChange={(e) => {
            setGeometry(e.target.value);
            setGeometryError('');
          }}
        />
        <BoundaryExamples
          disabled={saving}
          onUseExample={(sample, format: BoundaryFormat) => {
            setGeometry(sample);
            setGeometryError('');
            setInsertedNotice(INSERTED_NOTICE[format]);

            // The insert changes a field nobody focused, so it is announced
            // through the notification's role="status" and then handed back:
            // caret at the start, scrolled to the top, so the first thing seen
            // is the beginning of what was pasted in. After paint, or the
            // textarea still holds its old value.
            requestAnimationFrame(() => {
              const el = geometryRef.current;
              if (!el) return;
              el.focus();
              el.setSelectionRange(0, 0);
              el.scrollTop = 0;
            });
          }}
        />
      </div>

      <div className="add-fdu__field">
        <div className="add-fdu__licence-row">
          <TextInput
            id="add-fdu-licence"
            labelText="Licence numbers (optional)"
            placeholder="e.g. A12345"
            value={licenceInput}
            invalid={!!licenceError}
            invalidText={licenceError}
            disabled={saving || licenceChecking}
            onChange={(e) => {
              setLicenceInput(e.target.value);
              setLicenceError('');
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addLicence();
              }
            }}
          />
          <Button
            kind="tertiary"
            size="md"
            disabled={saving || licenceChecking || !licenceInput.trim()}
            onClick={() => void addLicence()}
          >
            Add
          </Button>
        </div>
        {licenceChecking && (
          <InlineLoading description="Checking licence number…" />
        )}
        {licences.length > 0 && (
          <div className="add-fdu__chips">
            {licences.map((id) => (
              <Tag
                key={id}
                type="blue"
                filter
                disabled={saving}
                onClose={() => setLicences((prev) => prev.filter((x) => x !== id))}
              >
                {id}
              </Tag>
            ))}
          </div>
        )}
      </div>

      <div className="fsp-species-modal__actions">
        <Button kind="tertiary" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          kind="primary"
          disabled={saving}
          onClick={() => void handleSubmit()}
        >
          {saving ? 'Adding…' : 'Add FDU'}
        </Button>
      </div>
    </Modal>
  );
};

export default AddFduModal;
export { AddFduModal };
