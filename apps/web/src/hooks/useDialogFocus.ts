import { useEffect, useLayoutEffect, useRef } from 'react';

/** Keep keyboard focus in the active dialog and restore its triggering control. */
export function useDialogFocus(active = true, onEscape?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const escapeCallback = useRef(onEscape);
  useLayoutEffect(() => { escapeCallback.current = onEscape; }, [onEscape]);
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    )).filter(element => element.getClientRects().length);
    (focusable()[0] || dialog).focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && escapeCallback.current) {
        // A foreground dialog handles dismissal before underlying window listeners.
        event.stopPropagation();
        if (!event.defaultPrevented) { event.preventDefault(); escapeCallback.current(); }
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener('keydown', trap);
    return () => { dialog.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [active]);
  return ref;
}
