import { useState } from "react";
import { Link } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsoleTable } from "../../components/console/ConsoleTable";
import { Card } from "../../components/ui/card";
import { TableCell, TableRow } from "../../components/ui/table";
import { CONSOLE_PATHS, LEDGER_COLUMNS } from "../../constants/console";
import { chainIntact, shortDigest } from "../../helpers/ledger";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleMono, consoleTone } from "../../styles/classes";

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
        actions={
          <ConsoleButton onClick={() => setVerified(state.ledger.length)}>Verify chain</ConsoleButton>
        }
      />

      {verified !== null && (
        <p className={cx("rounded-control px-4 py-3 font-semibold", consoleTone[intact ? "good" : "bad"])}>
          {intact ? `Chain intact: ${verified} records verified from genesis.` : "Chain broken."}
        </p>
      )}

      <Card className="gap-0 py-0">
        <ConsoleTable columns={LEDGER_COLUMNS}>
          {[...state.ledger].reverse().map((r) => (
            <TableRow key={r.seq}>
              <TableCell className={consoleMono}>{r.seq}</TableCell>
              <TableCell>{r.tick}</TableCell>
              <TableCell className={consoleMono}>
                <Link to={CONSOLE_PATHS.intent(r.intentId)}>#{r.intentId}</Link>
              </TableCell>
              <TableCell>{r.verdict ? <ConsoleBadge value={r.verdict} /> : r.kind}</TableCell>
              <TableCell>{r.summary}</TableCell>
              <TableCell className={cx(consoleMono, "text-muted")}>{shortDigest(r.digest)}</TableCell>
            </TableRow>
          ))}
        </ConsoleTable>
      </Card>
    </>
  );
}
