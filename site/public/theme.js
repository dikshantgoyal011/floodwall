// Resolve before the app paints, then keep browser chrome and manual choices in sync.
(() => {
  const key = "floodwall-theme";
  const media = matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  // Only the landing page and /pricing have the site's styles and a dark theme; useSiteDocument keeps
  // the mark when the app moves between routes. Elsewhere the theme is still tracked, but the page
  // stays light.
  const landing = location.pathname === "/" || location.pathname === "/pricing";
  root.classList.toggle("fw-site", landing);
  const meta = document.querySelector('meta[name="theme-color"]');
  const valid = value => value === "dark" || value === "light" ? value : null;
  let preference = null;
  try { preference = valid(localStorage.getItem(key)); } catch { /* Storage is optional. */ }
  let theme;

  function apply() {
    theme = preference ?? (media.matches ? "dark" : "light");
    // Swap every colour in one frame: live transitions would smear the change across the page.
    const still = document.createElement("style");
    still.textContent = "*, *::before, *::after { transition: none !important; }";
    document.head.append(still);
    root.dataset.theme = theme;
    // Off the landing page <html>'s scheme-light class keeps native controls light.
    if (landing) root.style.colorScheme = theme;
    // CSS is authoritative once loaded; the fallback also colors the initial tab.
    const canvas = getComputedStyle(root).getPropertyValue("--canvas").trim();
    const fallback = !landing ? "#f7fbff" : theme === "dark" ? "#111111" : "#f2f2f2";
    if (meta) meta.content = canvas || fallback;
    // The computed-style read above has applied the new colours; transitions return next frame.
    requestAnimationFrame(() => still.remove());
    window.dispatchEvent(new Event("floodwall:theme-change"));
  }

  window.floodwallTheme = {
    get: () => theme,
    set(value) {
      if (!valid(value)) return;
      preference = value;
      try { localStorage.setItem(key, value); } catch { /* Keep the in-memory choice. */ }
      apply();
    },
  };
  media.addEventListener("change", () => { if (!preference) apply(); });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue);
    apply();
  });
  document.addEventListener("DOMContentLoaded", apply, { once: true });
  apply();
})();
