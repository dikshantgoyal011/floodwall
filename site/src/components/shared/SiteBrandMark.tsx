/** The Floodwall mark in the site header and footer, drawn by `.brand-mark` in styles/landing/theme.css. */
export function SiteBrandMark() {
  return (
    <svg className="brand-mark" aria-hidden="true" viewBox="0 0 64 64">
      <rect x="7" y="7" width="50" height="50" rx="13" />
      <path d="M32 11v42" />
      <path d="M14 32h17M33 32h17" />
      <path d="M19 48c6-12 6-20 0-32M45 16c-6 12-6 20 0 32" />
    </svg>
  );
}
