import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { MOCK_ALLOWLIST, MOCK_POLICIES } from "../../constants/console-mock";
import { consoleGrow, consoleList, consoleMono, consoleRowPadded, consoleSub } from "../../styles/classes";

export function PoliciesPage() {
  return (
    <>
      <ConsolePageHeader title="Policies" description="The gate's policy stack, combined deny-overrides." />

      <Card className="gap-0 py-0">
        <ul className={consoleList}>
          {MOCK_POLICIES.map((p) => (
            <li key={p.name} className={consoleRowPadded}>
              <span className={consoleGrow}>
                <code>{p.name}</code>
                <span className={consoleSub}>{p.rule}</span>
              </span>
              <ConsoleBadge value={p.verdict} />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resource allowlist</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {MOCK_ALLOWLIST.map((r) => (
            <Badge key={r} variant="outline" className={consoleMono}>
              {r}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
