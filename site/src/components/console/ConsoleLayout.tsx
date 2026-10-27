import { Link, NavLink, Outlet } from "react-router";
import { CONSOLE_NAV, CONSOLE_PATHS } from "../../constants/console";
import { cx } from "../../helpers/cx";
import { usePlane } from "../../hooks/usePlane";
import { BrandMark } from "../shared/BrandMark";
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

/** The console shell under /app: a sidebar (a top bar on narrow screens) and the page. */
export function ConsoleLayout() {
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
          <p className="mt-auto rounded-control bg-subtle p-3 text-xs leading-normal text-muted console-narrow:hidden">
            Dummy data. Nothing here touches a real plane.
          </p>
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
