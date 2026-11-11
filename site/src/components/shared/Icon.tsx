import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

type IconProps = { icon: IconSvgElement; size?: number; className?: string };

/** Decorative icons share one stroke; their adjacent text supplies the accessible name. */
export function Icon({ icon, size = 20, className = "" }: IconProps) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.5}
    className={`ui-icon ${className}`} aria-hidden="true" focusable="false" />;
}
