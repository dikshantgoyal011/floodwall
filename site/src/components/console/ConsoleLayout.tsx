import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { AUTH_COPY, AUTH_PATHS } from "../../constants/auth";
import { CONSOLE_NAV, CONSOLE_PATHS } from "../../constants/console";
import { loginPath } from "../../helpers/auth";
import { cx } from "../../helpers/cx";
import { usePlane } from "../../hooks/usePlane";
import { useSession } from "../../hooks/useSession";
import { monoLabel } from "../../styles/classes";
import { BrandMark } from "../shared/BrandMark";
import { Button } from "../ui/button";
import { PlaneProvider } from "./PlaneProvider";

// Pages are open text on the gray plane; the current one is a white ruled cell, the landing page's sheet.
const NAV_LINK =
  "flex min-h-10 items-center justify-between border px-3 font-medium transition-[color,background,border-color] duration-160 ease-[cubic-bezier(.25,1,.5,1)] console-narrow:gap-1.5 console-narrow:whitespace-nowrap";

function HoldCount() {
  const { state } = usePlane();
  const held = state.intents.filter((i) => i.status === "held").length;
  return held > 0 ? (
    <span className="min-w-5 bg-warn-soft px-1.5 text-center font-mono text-[11px] leading-5 font-medium text-warn tabular-nums">
      {held}
    </span>
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
      <div className="grid min-h-screen grid-cols-[232px_minmax(0,1fr)] bg-paper text-sm text-ink console-narrow:grid-cols-[minmax(0,1fr)]">
        <aside
          className={cx(
            "sticky top-0 flex h-screen flex-col gap-8 border-r border-r-line bg-paper px-4 py-6",
            "console-narrow:static console-narrow:h-auto console-narrow:flex-row console-narrow:flex-wrap console-narrow:items-center console-narrow:gap-3",
            "console-narrow:[border-right:0] console-narrow:border-b console-narrow:border-b-line console-narrow:px-4 console-narrow:py-3",
          )}
        >
          <Link className="inline-flex items-center gap-2.5 px-2 text-xl leading-none font-medium tracking-[-0.03em]" to="/">
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
                    isActive ? "border-line bg-surface text-ink" : "border-transparent text-muted hover:text-ink",
                  )
                }
              >
                {label}
                {to === CONSOLE_PATHS.hold && <HoldCount />}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-4 console-narrow:contents">
            <p className={cx(monoLabel, "border border-line bg-surface p-3 leading-normal console-narrow:hidden")}>
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
