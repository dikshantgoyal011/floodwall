import { ArrowLeftIcon } from "lucide-react";
import { Link } from "react-router";

type ConsoleBackLinkProps = { to: string; children: string };

/** The link above a page's title back to the page it was opened from. */
export function ConsoleBackLink({ to, children }: ConsoleBackLinkProps) {
  return (
    <Link
      className="-mb-3 inline-flex items-center gap-1.5 self-start text-base font-semibold text-muted hover:text-ink"
      to={to}
    >
      <ArrowLeftIcon className="size-4" strokeWidth={2.5} aria-hidden="true" />
      {children}
    </Link>
  );
}
