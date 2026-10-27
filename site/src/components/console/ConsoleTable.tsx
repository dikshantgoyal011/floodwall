import type { ReactNode } from "react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table";
import { cx } from "../../helpers/cx";
import { consoleLabel } from "../../styles/classes";

type ConsoleTableProps = { columns: string[]; children: ReactNode };

/**
 * A shadcn Table with one header cell per column; `children` are its body rows (TableRow).
 * Header and body cells are all 40px tall, a step above the 36px buttons and tabs.
 * The Intents and Ledger tables both render this, so they always match.
 */
export function ConsoleTable({ columns, children }: ConsoleTableProps) {
  return (
    <Table className="[&_:is(th,td)]:h-10 [&_:is(th,td)]:px-4 [&_:is(th,td)]:py-0 [&_a:not([data-slot])]:font-semibold [&_a:not([data-slot])]:text-bay-deep">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead key={column} className={cx(consoleLabel, "bg-paper")}>
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
