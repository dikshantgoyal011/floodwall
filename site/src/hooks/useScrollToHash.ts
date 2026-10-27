import { useEffect } from "react";

/**
 * Scrolls to the section the URL's hash names, such as /#model, once the
 * page has rendered. The browser looks for it on load, before React renders
 * the sections, so without this a link from another page lands at the top.
 */
export function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
  }, []);
}
