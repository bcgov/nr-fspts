import { Modal as CarbonModal, type ModalProps } from '@carbon/react';
import { forwardRef } from 'react';

/**
 * Thin wrapper around Carbon's Modal that overrides the default
 * initial-focus behaviour. Carbon focuses the close button by default,
 * which shows a prominent blue focus ring on every modal open. This
 * wrapper instead focuses the first interactive form element (input,
 * select, textarea) or, failing that, any button that isn't the close
 * button.
 *
 * Any component can still override this per-modal by passing its own
 * `selectorPrimaryFocus` prop — the spread of `props` comes after the
 * default, so an explicit value will win.
 */
const Modal = forwardRef<HTMLDivElement, ModalProps>((props, ref) => (
  <CarbonModal
    selectorPrimaryFocus="input:not([type='hidden']), select, textarea, button:not(.cds--modal-close)"
    {...props}
    ref={ref}
  />
));

Modal.displayName = 'Modal';

export { Modal };
export type { ModalProps };
export default Modal;
