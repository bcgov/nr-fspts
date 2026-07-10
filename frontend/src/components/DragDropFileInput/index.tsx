import { Close, Document, WarningFilled } from '@carbon/icons-react';
import { type FC, useRef, useState } from 'react';

import './drag-drop-file-input.scss';

/**
 * Drag-and-drop file picker matching the data-submission page's dropzone
 * (dashed zone + blue "drag and drop … or click to upload" prompt + a
 * file chip with a remove button). Self-contained styles so it can be
 * dropped into any surface — the submission page's version was scoped to
 * that page's design tokens.
 *
 * <p>Controlled: the parent owns the selected {@link File} and validates
 * it in {@code onSelect}; this component only surfaces the pick and the
 * remove intent.
 */
interface Props {
  /** Bold label rendered above the dropzone. */
  label?: string;
  /** Small helper line under the label (accepted formats, size cap, …). */
  helperText?: string;
  /** The currently-selected file, or null. Drives the chip (single mode). */
  file?: File | null;
  /** Extension allow-list handed to the native picker, e.g. ['.pdf']. */
  accept?: readonly string[];
  disabled?: boolean;
  /** Render the file chip in an error state (red border + warning icon). */
  invalid?: boolean;
  /** Fired when a file is chosen via drop or the OS picker (single mode). */
  onSelect?: (file: File) => void;
  /** Fired when the user clears the chip (single mode). */
  onRemove?: () => void;

  // ── Multiple mode (opt-in) ────────────────────────────────────────
  /** Accept more than one file. Swaps the single-file props below in. */
  multiple?: boolean;
  /** Currently-selected files (multiple mode). One chip each. */
  files?: File[];
  /** Fired with the newly picked files; the parent owns the merged list. */
  onSelectMany?: (files: File[]) => void;
  /** Fired to drop the file at `index` (multiple mode). */
  onRemoveAt?: (index: number) => void;
}

const DragDropFileInput: FC<Props> = ({
  label,
  helperText,
  file,
  accept,
  disabled = false,
  invalid = false,
  onSelect,
  onRemove,
  multiple = false,
  files,
  onSelectMany,
  onRemoveAt,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const openDialog = () => {
    if (!disabled) inputRef.current?.click();
  };

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (multiple) {
      onSelectMany?.(Array.from(list));
    } else {
      const first = list[0];
      if (first) onSelect?.(first);
    }
  };

  const zoneLabel = multiple
    ? 'Drag and drop files here or click to upload'
    : 'Drag and drop a file here or click to upload';

  return (
    <div className="ddfi">
      {label && <span className="ddfi__label">{label}</span>}
      {helperText && <p className="ddfi__helper">{helperText}</p>}

      {/* Hidden native input backing both click-to-upload and the OS
          dialog. Reset value after each pick so re-selecting the same
          file still fires onChange. */}
      <input
        ref={inputRef}
        type="file"
        className="ddfi__input"
        accept={accept?.join(',')}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        className={`ddfi__zone${dragOver ? ' ddfi__zone--drag' : ''}${
          disabled ? ' ddfi__zone--disabled' : ''
        }`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={zoneLabel}
        onClick={openDialog}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDialog();
          }
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
      >
        <span className="ddfi__zone-label">{zoneLabel}</span>
      </div>

      {multiple
        ? (files ?? []).map((f, i) => (
            <div className="ddfi__chip" key={`${f.name}-${f.size}-${i}`}>
              <span className="ddfi__chip-icon">
                <Document size={16} />
              </span>
              <span className="ddfi__chip-name">{f.name}</span>
              <button
                type="button"
                className="ddfi__chip-remove"
                aria-label={`Remove ${f.name}`}
                disabled={disabled}
                onClick={() => onRemoveAt?.(i)}
              >
                <Close size={16} />
              </button>
            </div>
          ))
        : file && (
            <div className={`ddfi__chip${invalid ? ' ddfi__chip--error' : ''}`}>
              <span className="ddfi__chip-icon">
                <Document size={16} />
              </span>
              <span className="ddfi__chip-name">{file.name}</span>
              {invalid && (
                <span className="ddfi__chip-status">
                  <WarningFilled size={16} />
                </span>
              )}
              <button
                type="button"
                className="ddfi__chip-remove"
                aria-label="Remove file"
                disabled={disabled}
                onClick={onRemove}
              >
                <Close size={16} />
              </button>
            </div>
          )}
    </div>
  );
};

export default DragDropFileInput;
