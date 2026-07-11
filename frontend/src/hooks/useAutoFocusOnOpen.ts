import { useEffect, type RefObject } from 'react';

/**
 * Focus a modal's first field once the modal (and the field) are ready.
 *
 * Carbon's own modal-open focus pass does not reliably land on a
 * `ComboBox`: its downshift/focus-trap machinery steals focus back during
 * the open cycle, so a single `focus()` on the open frame gets undone.
 * (Empirically, the very same `focus()` call sticks when it runs on any
 * later, settled render — which is why a load-gated combo would focus
 * only on the frame its options finished loading, and never on reopen.)
 *
 * The fix is to re-apply focus across the first handful of animation
 * frames until it holds, then stop. Once the field owns focus the guard
 * skips further calls, so it won't fight a user who tabs away after
 * things settle.
 *
 * @param ref   Ref to the element to focus (ComboBox forwards its ref to
 *              the underlying input).
 * @param ready True when the modal is open and the field is mounted +
 *              enabled. Toggling this false→true (open, or a load
 *              completing) re-arms the focus attempt.
 */
export function useAutoFocusOnOpen(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
): void {
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const el = ref.current;
      if (el && document.activeElement !== el) el.focus();
      frame += 1;
      // ~8 frames (~130ms) covers Carbon's open-cycle focus settling.
      if (frame < 8) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [ref, ready]);
}
