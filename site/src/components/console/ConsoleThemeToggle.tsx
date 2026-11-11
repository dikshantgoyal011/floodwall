import { motion } from "motion/react";
import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "../../hooks/useTheme";
import { spring } from "../../lib/springs";
import { Icon } from "../shared/Icon";

// Two glyphs in one cell, crossfading with a touch of blur and scale, so the button never resizes.
// The arriving glyph takes the fast tier's full duration and the leaving one its exit, so an appear
// always outlasts a disappear.
const SHOWN = { opacity: 1, scale: 1, filter: "blur(0px)" };
const HIDDEN = { opacity: 0, scale: 0.6, filter: "blur(4px)" };
const enter = { type: "tween" as const, duration: spring.fast.duration, ease: "easeOut" as const };
const leave = { type: "tween" as const, ...spring.fast.exit, ease: "easeIn" as const };

/**
 * The console's light/dark switch, the same theme the landing page's footer switch sets (theme.js
 * remembers the choice). It names its pressed state and, in its tooltip, the theme it switches to.
 */
export function ConsoleThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      className="grid size-9 shrink-0 place-items-center border border-line text-muted transition-colors duration-150 hover:border-line-strong hover:text-ink"
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      <span className="grid size-4">
        <motion.span className="col-start-1 row-start-1 flex" initial={false} animate={dark ? HIDDEN : SHOWN} transition={dark ? leave : enter}>
          <Icon icon={Moon02Icon} size={16} />
        </motion.span>
        <motion.span className="col-start-1 row-start-1 flex" initial={false} animate={dark ? SHOWN : HIDDEN} transition={dark ? enter : leave}>
          <Icon icon={Sun01Icon} size={16} />
        </motion.span>
      </span>
    </button>
  );
}
