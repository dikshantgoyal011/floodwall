import { useCallback, useEffect, type FocusEvent, type RefObject } from "react";

/**
 * Closes an open disclosure (a button and the panel it shows, both inside `ref`) when the reader
 * presses outside it or presses Escape, which hands focus back to `button`. Returns the onBlur
 * handler for `ref`'s element, so tabbing out of it closes it too. `close` should be stable.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, ref, button]);

  return useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
    },
    [close],
  );
}
