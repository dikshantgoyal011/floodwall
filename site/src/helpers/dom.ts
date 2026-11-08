/** Dispatched on document with the target section's id when a section link moves the view. */
export const SECTION_NAVIGATION_EVENT = "floodwall:section-navigation";

/** Current height of the sticky site header, or 0 before it mounts. */
export function headerHeight() {
  return document.querySelector<HTMLElement>(".site-header")?.offsetHeight ?? 0;
}

/** The element id a URL fragment names, or "" if it is empty or malformed (e.g. "#%"). */
export function fragmentId(fragment: string) {
  try {
    return decodeURIComponent(fragment.replace(/^#/, ""));
  } catch {
    return "";
  }
}
