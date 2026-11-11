import type { ReactNode } from "react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table";
import { cx } from "../../helpers/cx";
import { consoleLabel, consoleWideOnly } from "../../styles/classes";

export type ConsoleColumn = { label: string; wideOnly?: boolean };

type ConsoleTableProps = { columns: ConsoleColumn[]; children: ReactNode };

/**
 * A shadcn Table in a flush ConsolePanel: mono header labels over a rule, 44px rows with the panel's
 * inset at either end, links in ink. `wideOnly` columns drop out on narrow screens; their cells take
 * `consoleWideOnly` too. The Intents and Ledger tables both render this, so they always match.
 * On wide screens the header row pins under the page's title bar; on narrow ones the table scrolls
 * sideways instead, fading the edge that has more to see (`.console-table` in index.css).
 */
export function ConsoleTable({ columns, children }: ConsoleTableProps) {
  return (
    <div className="console-table">
      <Table
        className={cx(
          "[&_:is(th,td)]:h-11 [&_:is(th,td)]:px-3 [&_:is(th,td)]:py-0 [&_:is(th,td):first-child]:pl-5 [&_:is(th,td):last-child]:pr-5",
          "[&_a:not([data-slot])]:font-medium [&_a:not([data-slot])]:text-ink [&_a:not([data-slot])]:underline-offset-4 [&_a:not([data-slot]):hover]:underline",
          "[&_tbody_tr]:hover:bg-tint-hover",
        )}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map(({ label, wideOnly }) => (
              <TableHead key={label} className={cx(consoleLabel, wideOnly && consoleWideOnly)}>
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}
