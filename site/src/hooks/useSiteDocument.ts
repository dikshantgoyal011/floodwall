import { useLayoutEffect } from "react";

/**
 * Marks <html> with .fw-site while the landing page or /pricing is shown, so styles/landing applies
 * to the whole document. theme.js adds the mark before the first paint on those paths; this keeps it
 * across client-side visits from other routes, and takes it and the landing page's inline colour
 * scheme away again when the app leaves for a page that is light only.
 */
export function useSiteDocument() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("fw-site");
    return () => {
      root.classList.remove("fw-site");
      root.style.removeProperty("color-scheme");
    };
  }, []);
}
