import { FOOTER_BRIDGE_PATHS, FOOTER_SKYLINE_PATHS } from "../../constants/graphics";
import { cx } from "../../helpers/cx";
import { bayLights, scenePath } from "../../styles/classes";
import { SvgPaths } from "./SvgPaths";

export function SiteFooterScene() {
  return (
    <div className="pointer-events-none absolute inset-0 z-1" aria-hidden="true">
      <div className="absolute inset-x-[-18%] top-[8%] h-75 animate-footer-fog bg-(image:--image-footer-fog) opacity-78 will-change-transform" />
      <div className={cx(bayLights, "h-60 opacity-24")} />
      <svg
        className="absolute bottom-[-5%] left-[-9%] h-[58%] w-[112%] animate-bridge-glow-slow text-[rgba(232,109,78,0.28)] opacity-58 will-change-transform"
        viewBox="0 0 1400 620"
        preserveAspectRatio="none"
      >
        <SvgPaths paths={FOOTER_BRIDGE_PATHS} className={cx(scenePath, "stroke-current")} />
      </svg>
      <svg
        className="absolute bottom-[18%] left-[-4%] h-[34%] w-[108%] stroke-4 text-[rgba(8,11,13,0.16)] opacity-50"
        viewBox="0 0 1400 320"
        preserveAspectRatio="none"
      >
        <SvgPaths paths={FOOTER_SKYLINE_PATHS} className={cx(scenePath, "stroke-current")} />
      </svg>
    </div>
  );
}
