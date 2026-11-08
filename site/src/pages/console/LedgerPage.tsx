import { useState } from "react";
import { Alert02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Link } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { ConsoleTable } from "../../components/console/ConsoleTable";
import { Icon } from "../../components/shared/Icon";
import { TableCell, TableRow } from "../../components/ui/table";
import { CONSOLE_PATHS, LEDGER_COLUMNS } from "../../constants/console";
import { chainIntact, shortDigest } from "../../helpers/ledger";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleMono, consoleTone, consoleWideOnly } from "../../styles/classes";

export function LedgerPage() {
  const { state } = usePlane();
  const [verified, setVerified] = useState<number | null>(null);
  const head = state.ledger.at(-1);
  const intact = chainIntact(state.ledger);

  return (
    <>
      <ConsolePageHeader
        title="Ledger"
        description={head ? `${state.ledger.length} records · head ${shortDigest(head.digest)}` : "Empty"}
        actions={<ConsoleButton onClick={() => setVerified(state.ledger.length)}>Verify chain</ConsoleButton>}
      />

      {/* Mounted empty, so the result is announced when it arrives. The icon and the words carry it; the
          tone repeats it. */}
      <div role="status" className="empty:hidden">
        {verified !== null && (
          <p className={cx("flex items-center gap-2.5 border border-current/25 px-4 py-3 text-sm font-medium", consoleTone[intact ? "good" : "bad"])}>
            <Icon icon={intact ? CheckmarkCircle02Icon : Alert02Icon} size={18} />
            {intact ? `Chain intact: ${verified} records verified from genesis.` : "Chain broken: a record no longer matches its digest."}
          </p>
        )}
      </div>

      <ConsolePanel flush>
        <ConsoleTable columns={LEDGER_COLUMNS}>
          {[...state.ledger].reverse().map((r) => (
            <TableRow key={r.seq}>
              <TableCell className={cx(consoleMono, "text-muted")}>{r.seq}</TableCell>
              <TableCell className={cx(consoleMono, consoleWideOnly)}>{r.tick}</TableCell>
              <TableCell className={consoleMono}>
                <Link to={CONSOLE_PATHS.intent(r.intentId)}>#{r.intentId}</Link>
              </TableCell>
              <TableCell>{r.verdict ? <ConsoleBadge value={r.verdict} /> : <span className="font-mono text-[11px] text-muted">{r.kind}</span>}</TableCell>
              <TableCell className="text-ink-soft">{r.summary}</TableCell>
              <TableCell className={cx(consoleMono, "text-muted")}>{shortDigest(r.digest)}</TableCell>
            </TableRow>
          ))}
        </ConsoleTable>
      </ConsolePanel>
    </>
  );
}
