import { Modal as CarbonModal, type ModalProps } from '@carbon/react';
import { forwardRef, useEffect } from 'react';

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
const Modal = forwardRef<HTMLDivElement, ModalProps>((props, ref) => {
  // Carbon's initialFocus falls back to focusing the close (X) button
  // whenever selectorPrimaryFocus matches nothing (e.g. a field-less
  // passive modal). We never want the X focused on open. Carbon runs its
  // focus pass in the child effect (children run before parents), so by
  // the time this parent effect fires the X may already be focused — a
  // rAF lets any focus settle, then we drop it off the close button.
  useEffect(() => {
    if (!props.open) return;
    const raf = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.classList.contains('cds--modal-close')) {
        active.blur();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [props.open]);

  return (
    <CarbonModal
      selectorPrimaryFocus="input:not([type='hidden']), select, textarea, button:not(.cds--modal-close)"
      {...props}
      ref={ref}
    />
  );
});

Modal.displayName = 'Modal';

export { Modal };
export type { ModalProps };
export default Modal;
