import { spring } from "./springs";

/**
 * A header panel's motion: it drops 4px into place and grows from 98% at its top edge. A spring,
 * so a close that interrupts an open reverses from where it is; the close is the tier's quicker
 * tween. Spread it onto a motion element inside AnimatePresence.
 */
const PANEL_HIDDEN = { opacity: 0, y: -4, scale: 0.98 };

export const panelMotion = {
  initial: PANEL_HIDDEN,
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { ...PANEL_HIDDEN, transition: spring.moderate.exit },
  transition: spring.moderate,
};
