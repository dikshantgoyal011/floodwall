import {
  HERO_BRIDGE_PATHS,
  HERO_FOG_LANES,
  HERO_SKYLINE_PATHS,
  HERO_WALL_LAYERS,
} from "../../constants/graphics";
import { cx } from "../../helpers/cx";
import { bayLights, scenePath } from "../../styles/classes";
import { SvgPaths } from "../shared/SvgPaths";

/** Illustrated bay scene: shown on its own when video is off, and behind the video while it loads. */
export function LandingHeroScene() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {HERO_FOG_LANES.map((lane) => (
        <div
          key={lane}
          className={cx("absolute inset-x-[-16%] bg-(image:--image-hero-fog) will-change-transform", lane)}
        />
      ))}
      <div className={cx(bayLights, "h-45")} />
      <svg
        className="absolute right-[-9%] bottom-[2%] h-[48%] w-[min(980px,82vw)] animate-bridge-glow stroke-3 text-bridge opacity-28 will-change-transform mobile:w-[116vw] mobile:opacity-22"
        viewBox="0 0 1200 640"
        preserveAspectRatio="none"
      >
        <SvgPaths paths={HERO_BRIDGE_PATHS} className={cx(scenePath, "stroke-current")} />
      </svg>
      <svg
        className="absolute right-[-2%] bottom-[7%] h-[32%] w-[min(1000px,92vw)] stroke-3 text-[rgba(47,110,137,0.36)] mobile:w-[120vw] mobile:opacity-72"
        viewBox="0 0 1200 280"
        preserveAspectRatio="none"
      >
        <SvgPaths paths={HERO_SKYLINE_PATHS} className={cx(scenePath, "stroke-current")} />
      </svg>
      <div
        className={cx(
          "absolute top-[27%] right-[max(32px,8vw)] grid w-44 gap-3 opacity-78 tablet:right-6 tablet:opacity-46 mobile:hidden",
          "before:absolute before:-top-12 before:-bottom-12 before:-left-7 before:w-1 before:rounded-pill",
          "before:bg-[linear-gradient(180deg,transparent,var(--color-bridge),var(--color-gold),transparent)] before:shadow-[0_0_32px_rgba(232,109,78,0.24)]",
        )}
      >
        {HERO_WALL_LAYERS.map((layer) => (
          <span
            key={layer}
            className="rounded-pill border border-line bg-[rgba(255,255,255,0.68)] px-4 py-2 text-xs font-bold tracking-[0.04em] text-bay-deep uppercase backdrop-blur-[14px]"
          >
            {layer}
          </span>
        ))}
      </div>
    </div>
  );
}
