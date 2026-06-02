import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus trap for modal overlays (level-up picker, pause, end screen).
 *
 * On mount it focuses the container itself (which carries `tabIndex={-1}` and
 * `role="dialog"`, so assistive tech announces the modal), keeps Tab /
 * Shift+Tab cycling within the panel's focusable children instead of leaking
 * to the game canvas underneath, and restores focus to whatever was focused
 * before the modal opened when it unmounts.
 *
 * Attach the returned ref to the panel element and pair it with
 * `role="dialog" aria-modal="true" tabIndex={-1}`.
 */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    node.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        // Nothing focusable inside — keep focus pinned to the dialog container.
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || active === node || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return ref;
}
