import type { ReactNode } from "react";

type ConsoleEmptyProps = { title: string; children?: ReactNode; action?: ReactNode };

/** Where a list or table has nothing in it: what belongs here, and the way to fill it or move on. */
export function ConsoleEmpty({ title, children, action }: ConsoleEmptyProps) {
  return (
    <div className="flex flex-col items-start gap-1.5 px-5 py-8 console-narrow:px-4">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children && <p className="max-w-[60ch] text-sm leading-normal text-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
