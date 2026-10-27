import { useSearchParams } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleOpenIntent } from "../../components/console/ConsoleOpenIntent";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsoleTable } from "../../components/console/ConsoleTable";
import { Card } from "../../components/ui/card";
import { TableCell, TableRow } from "../../components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { CONSOLE_PATHS, INTENT_COLUMNS, INTENT_FILTERS } from "../../constants/console";
import { describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { consoleMono } from "../../styles/classes";

export function IntentsPage() {
  const { state } = usePlane();
  const [params, setParams] = useSearchParams();
  const active = INTENT_FILTERS.find((f) => f.key === params.get("status")) ?? INTENT_FILTERS[0];
  const intents = state.intents
    .filter((i) => !active.statuses || active.statuses.includes(i.status))
    .sort((a, b) => b.id - a.id);

  return (
    <>
      <ConsolePageHeader
        title="Intents"
        description="Every change an agent has asked to make."
        actions={
          <ConsoleButton to={CONSOLE_PATHS.newIntent}>Submit intent</ConsoleButton>
        }
      />

      <Tabs value={active.key} onValueChange={(key) => setParams(key === "all" ? {} : { status: key })}>
        {/* 36px, like the console's buttons; shadcn's default is 32px. */}
        <TabsList className="group-data-horizontal/tabs:h-9">
          {INTENT_FILTERS.map((f) => (
            <TabsTrigger key={f.key} value={f.key} className="px-3">
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="gap-0 py-0">
        {intents.length === 0 ? (
          <ConsoleEmpty>No intents here.</ConsoleEmpty>
        ) : (
          <ConsoleTable columns={INTENT_COLUMNS}>
            {intents.map((intent) => (
              <TableRow key={intent.id} className="group/row">
                {/* w-0: the column shrinks to its content instead of taking a share of the spare width. */}
                <TableCell className="w-0">
                  <span className="flex items-center gap-2">
                    <span className={consoleMono}>#{intent.id}</span>
                    {/* Hidden until the row is hovered or holds keyboard focus. */}
                    <ConsoleOpenIntent
                      id={intent.id}
                      className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                    >
                      Open
                    </ConsoleOpenIntent>
                  </span>
                </TableCell>
                <TableCell>{intent.agent}</TableCell>
                <TableCell>{describeAction(intent.action)}</TableCell>
                <TableCell>{intent.priority}</TableCell>
                <TableCell>{intent.blast}</TableCell>
                <TableCell>
                  <ConsoleBadge value={intent.status} />
                </TableCell>
              </TableRow>
            ))}
          </ConsoleTable>
        )}
      </Card>
    </>
  );
}
