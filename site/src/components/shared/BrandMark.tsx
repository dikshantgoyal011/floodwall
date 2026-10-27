import { BRAND_MARK_PATHS } from "../../constants/graphics";
import { cx } from "../../helpers/cx";
import { SvgPaths } from "./SvgPaths";

const STROKE = "fill-none stroke-current stroke-[2.4]";

/** The Floodwall mark, sized by `className` (32px, 28px on phones, by default). */
export function BrandMark({ className = "size-8 mobile:size-7" }: { className?: string }) {
  return (
    <svg className={cx("flex-none", className)} aria-hidden="true" viewBox="0 0 64 64">
      <rect className={STROKE} x="7" y="7" width="50" height="50" rx="13" />
      <SvgPaths paths={BRAND_MARK_PATHS} className={STROKE} />
    </svg>
  );
}
