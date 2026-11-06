/** Current height of the fixed site header, or 0 before it mounts. */
export function headerHeight() {
  return document.querySelector<HTMLElement>("[data-site-header]")?.offsetHeight ?? 0;
}

/** Sent on document when a section link moves the view, so the header can mark its destination at once. */
export const SECTION_NAVIGATION_EVENT = "floodwall:section-navigation";

/** The element id a URL fragment names, or "" if it is empty or malformed (e.g. "#%"). */
export function fragmentId(fragment: string) {
  try {
    return decodeURIComponent(fragment.replace(/^#/, ""));
  } catch {
    return "";
  }
}
