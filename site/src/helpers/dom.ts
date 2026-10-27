/** Current height of the fixed site header, or 0 before it mounts. */
export function headerHeight() {
  return document.querySelector<HTMLElement>("[data-site-header]")?.offsetHeight ?? 0;
}
