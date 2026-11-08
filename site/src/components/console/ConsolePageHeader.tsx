import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { useStuck } from "../../hooks/useStuck";
import { consoleActions } from "../../styles/classes";

type ConsolePageHeaderProps = { title: string; description?: string; actions?: ReactNode };

/** The CSS variable carrying the bar's height, for the table heads that pin below it and scroll padding. */
const BAR_HEIGHT = "--console-bar-h";

/**
 * A console page's title bar and, under it, its description. The bar pins to the top of the window as
 * the page scrolls, keeping the title and the page's actions in reach; the description scrolls away
 * beneath it. Pinned, the bar fades the content passing under its lower edge. Its height never
 * changes, so pinning moves nothing on the page.
 */
export function ConsolePageHeader({ title, description, actions }: ConsolePageHeaderProps) {
  const barRef = useRef<HTMLElement>(null);
  const stuck = useStuck(barRef);

  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Floodwall console`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  // Publish the bar's height, which grows when its actions wrap on narrow screens.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(BAR_HEIGHT, `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BAR_HEIGHT);
    };
  }, []);

  return (
    <>
      {/* Spans the page's side padding (console main's px-10, px-4 narrow) so content never shows
          beside it. The fade is the bar's ::after, hung from its lower edge. */}
      <header
        ref={barRef}
        data-stuck={stuck || undefined}
        className={cx(
          "sticky top-0 z-20 -mx-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-paper px-10 py-3",
          "console-narrow:-mx-4 console-narrow:px-4",
          "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-10 after:bg-linear-to-b after:from-paper after:to-transparent",
          "after:opacity-0 after:transition-opacity after:duration-150 data-stuck:after:opacity-100",
        )}
      >
        <h1 className="min-w-0 text-[30px] leading-[1.1] font-[550] tracking-[-0.03em] text-balance text-ink console-narrow:text-[26px]">
          {title}
        </h1>
        {actions && <div className={consoleActions}>{actions}</div>}
      </header>
      {/* -mt-7 pulls the description up through main's gap-6 and the bar's pb-3, 8px under the title row. */}
      {description && <p className="-mt-7 max-w-[65ch] text-sm leading-normal text-pretty text-muted">{description}</p>}
    </>
  );
}
