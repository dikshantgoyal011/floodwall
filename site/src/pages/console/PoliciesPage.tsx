import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { MOCK_ALLOWLIST, MOCK_POLICIES } from "../../constants/console-mock";
import { consoleGrow, consoleList, consoleRow, consoleSub } from "../../styles/classes";

export function PoliciesPage() {
  return (
    <>
      <ConsolePageHeader title="Policies" description="The gate's policy stack, combined deny-overrides." />

      <ConsolePanel title="Policy stack" flush action="Harshest verdict wins">
        <ul className={consoleList}>
          {MOCK_POLICIES.map((p) => (
            <li key={p.name} className={consoleRow}>
              <span className={consoleGrow}>
                <code className="text-ink">{p.name}</code>
                <span className={consoleSub}>{p.rule}</span>
              </span>
              <ConsoleBadge value={p.verdict} />
            </li>
          ))}
        </ul>
      </ConsolePanel>

      <ConsolePanel title="Resource allowlist">
        <ul className="flex flex-wrap gap-2">
          {MOCK_ALLOWLIST.map((r) => (
            <li key={r} className="border border-line px-2.5 py-1 font-mono text-[13px] text-ink">
              {r}
            </li>
          ))}
        </ul>
      </ConsolePanel>
    </>
  );
}
