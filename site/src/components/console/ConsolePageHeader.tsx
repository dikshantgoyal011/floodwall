import type { ReactNode } from "react";
import { consoleActions } from "../../styles/classes";

type ConsolePageHeaderProps = { title: string; description?: string; actions?: ReactNode };

export function ConsolePageHeader({ title, description, actions }: ConsolePageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl leading-[1.2] font-bold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 text-muted">{description}</p>}
      </div>
      {actions && <div className={consoleActions}>{actions}</div>}
    </header>
  );
}
