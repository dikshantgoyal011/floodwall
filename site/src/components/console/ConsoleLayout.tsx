import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { AUTH_COPY, AUTH_PATHS } from "../../constants/auth";
import { CONSOLE_NAV, CONSOLE_PATHS } from "../../constants/console";
import { loginPath } from "../../helpers/auth";
import { cx } from "../../helpers/cx";
import { usePlane } from "../../hooks/usePlane";
import { useSession } from "../../hooks/useSession";
import { BrandMark } from "../shared/BrandMark";
import { Button } from "../ui/button";
import { PlaneProvider } from "./PlaneProvider";

const NAV_LINK =
  "flex items-center justify-between rounded-control px-3 py-2.25 font-semibold transition-[background] duration-150 ease-[ease] console-narrow:gap-1.5 console-narrow:whitespace-nowrap";

function HoldCount() {
  const { state } = usePlane();
  const held = state.intents.filter((i) => i.status === "held").length;
  return held > 0 ? (
    <span className="min-w-5 rounded-pill bg-warn-soft px-1.75 py-px text-center text-xs text-warn">{held}</span>
  ) : null;
}

/**
 * The console shell under /app: a sidebar (a top bar on narrow screens) and
 * the page. Signed-out visitors go to sign in first and come back here.
 */
export function ConsoleLayout() {
  const { session, signOut } = useSession();
  const location = useLocation();

  if (session.status === "loading") return null;
  if (session.status === "signedOut") return <Navigate to={loginPath(location.pathname + location.search)} replace />;

  return (
    <PlaneProvider>
      {/* React hoists this into <head>: the console is shared by URL, not meant for search. */}
      <meta name="robots" content="noindex, nofollow" />
      <div className="grid min-h-screen grid-cols-[232px_minmax(0,1fr)] bg-subtle text-sm console-narrow:grid-cols-[1fr]">
        <aside
          className={cx(
            "sticky top-0 flex h-screen flex-col gap-8 border-r border-r-line bg-paper px-4 py-6",
            "console-narrow:static console-narrow:h-auto console-narrow:flex-row console-narrow:flex-wrap console-narrow:items-center console-narrow:gap-3",
            "console-narrow:[border-right:0] console-narrow:border-b console-narrow:border-b-line console-narrow:px-4 console-narrow:py-3",
          )}
        >
          <Link className="inline-flex items-center gap-2.5 px-2 font-display text-xl leading-none" to="/">
            <BrandMark className="size-6.5" />
            <span>Floodwall</span>
          </Link>
          <nav
            className="flex flex-col gap-0.5 console-narrow:flex-row console-narrow:overflow-x-auto"
            aria-label="Console"
          >
            {CONSOLE_NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    NAV_LINK,
                    isActive ? "bg-tint-active text-ink" : "text-ink-soft hover:bg-tint-hover hover:text-ink",
                  )
                }
              >
                {label}
                {to === CONSOLE_PATHS.hold && <HoldCount />}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-4 console-narrow:contents">
            <p className="rounded-control bg-subtle p-3 text-xs leading-normal text-muted console-narrow:hidden">
              Dummy data. Nothing here touches a real plane.
            </p>
            <div className="flex items-center gap-2 px-2 console-narrow:ml-auto">
              <Link className="min-w-0 flex-1 truncate font-semibold console-narrow:hidden" to={AUTH_PATHS.account}>
                {session.user.email}
              </Link>
              <Button variant="outline" size="sm" onClick={() => void signOut()}>
                {AUTH_COPY.signOut}
              </Button>
            </div>
          </div>
        </aside>
        <main
          className={cx(
            "flex w-full flex-col gap-6 px-12 pt-10 pb-16 console-narrow:px-4 console-narrow:pt-6 console-narrow:pb-12",
            "[&_code]:font-mono [&_code]:text-[13px]",
          )}
        >
          <Outlet />
        </main>
      </div>
    </PlaneProvider>
  );
}
