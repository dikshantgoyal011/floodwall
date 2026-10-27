import type { ReactNode } from "react";
import { Card, CardContent } from "../ui/card";
import { consoleLabel } from "../../styles/classes";

type ConsoleStatProps = { label: string; value: ReactNode; hint?: string };

export function ConsoleStat({ label, value, hint }: ConsoleStatProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5">
        <span className={consoleLabel}>{label}</span>
        <strong className="text-2xl leading-[1.1] font-bold tracking-[-0.02em]">{value}</strong>
        {hint && <span className="text-muted">{hint}</span>}
      </CardContent>
    </Card>
  );
}
