import { REDUCED_MOTION_QUERY, TABLET_QUERY } from "../constants/media";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Background video plays only on tablet-width screens and up, and never for
 * visitors who prefer reduced motion or have Save-Data turned on.
 */
export function useVideoEligibility() {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const tablet = useMediaQuery(TABLET_QUERY);
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  return !reducedMotion && tablet && !saveData;
}
