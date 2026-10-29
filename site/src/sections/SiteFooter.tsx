import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Moon02Icon, PauseIcon, PlayIcon, Sun01Icon } from "@hugeicons/core-free-icons";
import { FOOTER_GROUPS, PROTO_URL } from "../content";
import { BrandMark } from "../components/BrandMark";
import { FooterArtwork } from "../components/FooterArtwork";
import { Icon } from "../components/Icon";
import { useMediaQuery } from "../hooks";
import { useTheme } from "../theme";

export function SiteFooter() {
  const { theme, toggleTheme } = useTheme();
  const artworkRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const running = visible && !paused && !reducedMotion;

  useLayoutEffect(() => {
    for (const element of artworkRef.current?.querySelectorAll(".footer-animated") ?? []) {
      for (const animation of element.getAnimations()) {
        if (running) animation.play();
        else {
          // Resolve CSS's pending pause immediately, preserving the exact visible frame.
          const time = animation.currentTime;
          animation.pause();
          if (time !== null) animation.currentTime = time;
        }
      }
    }
  }, [running]);

  useEffect(() => {
    const artwork = artworkRef.current;
    if (!artwork) return;
    let intersecting = false;
    const syncVisibility = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      syncVisibility();
    });
    observer.observe(artwork);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  return (
    <footer className="site-footer" aria-labelledby="footer-title">
      <div className="footer-content">
        <div className="footer-scene">
          <div className="footer-panorama">
            <FooterArtwork running={running} rootRef={artworkRef} />
          </div>
          <div className="footer-heading">
            <div className="footer-brand">
              <a className="logo" href="#home" aria-label="Floodwall home">
                <BrandMark />
                <span>Floodwall</span>
              </a>
            </div>
            <h2 className="display-heading staccato-heading" id="footer-title">
              Built where fog meets <strong>production traffic.</strong>
            </h2>
            <p className="footer-lead">
              A bright control-plane surface for the moment agents start moving faster than human
              review queues.
            </p>
          </div>

          <div className="footer-body">
            <nav className="footer-links" aria-label="Footer">
              {FOOTER_GROUPS.map(({ title, links }) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <ul>
                    {links.map(({ label, href }) => (
                      <li key={label}>
                        <a href={href}>{label}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-copyright" suppressHydrationWarning>&copy; {new Date().getFullYear()} Floodwall.</span>
          <span className="footer-credit">
            An <a href="https://www.erp.ai">ERP•AI</a>{" "}
            project. · Built with{" "}
            <a href={PROTO_URL}>Proto</a>
          </span>
          <button className="footer-control footer-motion-control" type="button" disabled={reducedMotion}
            aria-label={reducedMotion ? "Footer animation disabled for reduced motion" : paused ? "Resume footer animation" : "Pause footer animation"}
            title={reducedMotion ? "Animation disabled for reduced motion" : paused ? "Play" : "Pause"}
            onClick={() => setPaused(value => !value)}>
            <Icon icon={paused ? PlayIcon : PauseIcon} size={20} />
          </button>
          <button className="footer-control footer-theme-control" type="button" aria-label="Dark mode"
            aria-pressed={theme === "dark"} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}>
            <Icon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={20} />
          </button>
        </div>
      </div>
    </footer>
  );
}
