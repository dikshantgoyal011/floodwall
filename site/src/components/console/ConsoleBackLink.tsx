import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Link } from "react-router";
import { Icon } from "../shared/Icon";

type ConsoleBackLinkProps = { to: string; children: string };

/** The link above a page's title back to the page it was opened from; -mb-5 sets it 16px over the title bar's text. */
export function ConsoleBackLink({ to, children }: ConsoleBackLinkProps) {
  return (
    <Link
      className="-mb-5 inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-medium text-muted transition-colors duration-150 hover:text-ink"
      to={to}
    >
      <Icon icon={ArrowLeft01Icon} size={16} />
      {children}
    </Link>
  );
}
