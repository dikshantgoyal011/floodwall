import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CONSOLE_PATHS } from "../../constants/console";
import { Icon } from "../shared/Icon";
import { Button } from "../ui/button";

type ConsoleOpenIntentProps = { id: number; className?: string; children: ReactNode };

/** A small button that opens intent `id`; its arrow nudges forward on hover. */
export function ConsoleOpenIntent({ id, className, children }: ConsoleOpenIntentProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      nativeButton={false}
      render={<Link to={CONSOLE_PATHS.intent(id)} aria-label={`Open intent #${id}`} />}
    >
      {children}
      <Icon icon={ArrowRight01Icon} size={14} className="transition-transform duration-150 group-hover/button:translate-x-0.5" />
    </Button>
  );
}
