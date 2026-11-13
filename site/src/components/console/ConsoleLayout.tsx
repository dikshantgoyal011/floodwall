import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import {
  DashboardSquare02Icon,
  GitPullRequestIcon,
  HourglassIcon,
  Link04Icon,
  Logout03Icon,
  SecurityCheckIcon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { AUTH_COPY, AUTH_PATHS } from "../../constants/auth";
import { ADMIN_NAV, CONSOLE_NAV, CONSOLE_PATHS } from "../../constants/console";
import { accountLabel, loginPath } from "../../helpers/auth";
import { cx } from "../../helpers/cx";
import { useFluidHover, useRegisterFluidHoverItem } from "../../hooks/use-fluid-hover";
import { usePlane } from "../../hooks/usePlane";
import { useSession } from "../../hooks/useSession";
import { SessionUnavailable } from "../auth/SessionUnavailable";
import { FluidHoverHighlight } from "../fluid-hover-highlight";
import { BrandMark } from "../shared/BrandMark";
import { Icon } from "../shared/Icon";
import { ConsoleThemeToggle } from "./ConsoleThemeToggle";
import { PlaneProvider } from "./PlaneProvider";

/** Each page's icon in the sidebar; Ledger and Policies match the landing page's How it works menu. */
const NAV_ICONS: Record<string, IconSvgElement> = {
  [CONSOLE_PATHS.overview]: DashboardSquare02Icon,
  [CONSOLE_PATHS.intents]: GitPullRequestIcon,
  [CONSOLE_PATHS.hold]: HourglassIcon,
  [CONSOLE_PATHS.ledger]: Link04Icon,
  [CONSOLE_PATHS.policies]: SecurityCheckIcon,
  [CONSOLE_PATHS.admin]: UserCheck01Icon,
};

// The rows touch, so the hover highlight glides from one to the next. The current page is a white
// ruled cell, the landing page's sheet; the others are open text on the plane.
const NAV_LINK =
  "flex h-9 items-center gap-2.5 border px-3 text-sm whitespace-nowrap transition-[color,background-color,border-color] duration-150";

/** A square icon button in the sidebar's footer row. */
const FOOTER_BUTTON =
  "grid size-9 shrink-0 place-items-center border border-line text-muted transition-colors duration-150 hover:border-line-strong hover:text-ink";

function HoldCount() {
  const { state } = usePlane();
  const held = state.intents.filter((i) => i.status === "held").length;
  return held > 0 ? (
    <span className="ml-auto min-w-5 bg-warn-soft px-1.5 text-center font-mono text-[11px] leading-5 font-medium text-warn tabular-nums">
      <span className="sr-only">, </span>
      {held}
      <span className="sr-only"> on hold</span>
    </span>
  ) : null;
}

type NavEntry = (typeof CONSOLE_NAV)[number] | typeof ADMIN_NAV;

type NavItemProps = { index: number; registerItem: (index: number, element: HTMLElement | null) => void } & NavEntry;

function NavItem({ index, registerItem, to, label, end }: NavItemProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <li className="relative">
      <NavLink
        ref={ref}
        to={to}
        end={end}
        className={({ isActive }) =>
          cx(NAV_LINK, isActive ? "border-line bg-surface font-medium text-ink" : "border-transparent text-muted hover:text-ink")
        }
      >
        <Icon icon={NAV_ICONS[to]} size={16} />
        <span>{label}</span>
        {to === CONSOLE_PATHS.hold && <HoldCount />}
      </NavLink>
    </li>
  );
}

function ConsoleNav({ items }: { items: NavEntry[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  return (
    <nav aria-label="Console" className="min-w-0 console-narrow:order-last console-narrow:w-full">
      <ul
        ref={listRef}
        {...hover.handlers}
        className="relative flex flex-col console-narrow:flex-row console-narrow:flex-wrap"
      >
        <FluidHoverHighlight hover={hover} className="bg-tint-hover" />
        {items.map((item, index) => (
          <NavItem key={item.to} index={index} registerItem={hover.registerItem} {...item} />
        ))}
      </ul>
    </nav>
  );
}

/**
 * The console shell under /app: a sidebar on the gray plane (a top bar on narrow screens) and the
 * page. Signed-out visitors go to sign in first and come back here; an account on the waitlist goes
 * to /waitlist. Admins also see Admin. Moving between pages hands keyboard focus to the new page,
 * as a full page load would.
 */
export function ConsoleLayout() {
  const { session, refresh, signOut } = useSession();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstPath = useRef(true);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  if (session.status === "loading") return null;
  if (session.status === "unavailable") return <SessionUnavailable onRetry={refresh} />;
  if (session.status === "signedOut") return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  if (session.user.waiting) return <Navigate to={AUTH_PATHS.waitlist} replace />;
  const nav = session.user.admin ? [...CONSOLE_NAV, ADMIN_NAV] : CONSOLE_NAV;

  return (
    <PlaneProvider>
      {/* React hoists this into <head>: the console is shared by URL, not meant for search. */}
      <meta name="robots" content="noindex, nofollow" />
      <a
        href="#console-main"
        className="sr-only bg-action px-4 py-2 text-sm font-medium text-action-text focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] bg-paper text-sm text-ink console-narrow:grid-cols-[minmax(0,1fr)]">
        <aside
          className={cx(
            "sticky top-0 flex h-screen flex-col gap-6 border-r border-line px-3 py-5",
            "console-narrow:static console-narrow:h-auto console-narrow:flex-row console-narrow:flex-wrap console-narrow:items-center console-narrow:gap-x-3 console-narrow:gap-y-2",
            "console-narrow:border-r-0 console-narrow:border-b console-narrow:px-4 console-narrow:py-3",
          )}
        >
          <Link className="inline-flex items-center gap-2.5 px-3 text-lg leading-none font-medium tracking-[-0.03em] text-ink console-narrow:px-0" to="/">
            <BrandMark className="size-6" />
            <span>Floodwall</span>
          </Link>
          <ConsoleNav items={nav} />
          <div className="mt-auto flex flex-col gap-4 console-narrow:mt-0 console-narrow:ml-auto">
            <p className="px-3 text-xs leading-normal text-muted console-narrow:hidden">
              Dummy data. Nothing here touches a real plane.
            </p>
            <div className="flex items-center gap-2 border-t border-line pt-3 console-narrow:border-t-0 console-narrow:pt-0">
              <Link
                className="min-w-0 flex-1 truncate px-3 text-sm font-medium text-ink hover:underline console-narrow:hidden"
                to={AUTH_PATHS.account}
                title={session.user.email}
              >
                {accountLabel(session.user)}
              </Link>
              <ConsoleThemeToggle />
              <button
                type="button"
                className={FOOTER_BUTTON}
                aria-label={AUTH_COPY.signOut}
                title={AUTH_COPY.signOut}
                onClick={() => {
                  setSignOutFailed(false);
                  signOut().catch(() => setSignOutFailed(true));
                }}
              >
                <Icon icon={Logout03Icon} size={16} />
              </button>
            </div>
            <p role="status" aria-live="polite" className="px-3 text-xs leading-normal text-muted empty:hidden">
              {signOutFailed ? AUTH_COPY.signOutFailed : ""}
            </p>
          </div>
        </aside>
        <main
          id="console-main"
          ref={mainRef}
          tabIndex={-1}
          className="flex w-full max-w-[1200px] flex-col gap-6 px-10 pt-6 pb-16 console-narrow:px-4 console-narrow:pt-3 console-narrow:pb-12 [&_code]:font-mono [&_code]:text-[13px]"
        >
          <Outlet />
        </main>
      </div>
    </PlaneProvider>
  );
}
