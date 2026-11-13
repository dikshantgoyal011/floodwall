import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { ConsoleTable } from "../../components/console/ConsoleTable";
import { TableCell, TableRow } from "../../components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ADMIN_COLUMNS, ADMIN_COPY, ADMIN_FILTERS, adminDate } from "../../constants/admin";
import { adminClient } from "../../helpers/admin";
import { consoleSub, consoleWideOnly } from "../../styles/classes";
import type { AdminAccount, SignupMode } from "../../types/auth";

type Listing = { signup: SignupMode; users: AdminAccount[] };

const STATUS_TONE: Record<AdminAccount["status"], string> = { waiting: "warn", approved: "good" };

/**
 * The waitlist for admins: every account, the waiting ones first, with
 * Approve and Remove. The service refuses anyone who isn't an admin, and the
 * page shows its answer.
 */
export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const filter = ADMIN_FILTERS.find((f) => f.key === params.get("status")) ?? ADMIN_FILTERS[0];
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<{ email: string; action: "approve" | "remove" } | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setListing(await adminClient.list());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(email: string, action: "approve" | "remove") {
    if (busy) return;
    if (action === "remove" && !window.confirm(ADMIN_COPY.confirmRemove(email))) return;
    setBusy({ email, action });
    setStatus("");
    try {
      if (action === "approve") {
        const { emailed, alreadyApproved } = await adminClient.approve(email);
        setStatus(
          alreadyApproved
            ? ADMIN_COPY.alreadyApproved(email)
            : emailed
              ? ADMIN_COPY.approved(email)
              : ADMIN_COPY.approvedNoEmail(email),
        );
      } else {
        await adminClient.remove(email);
        setStatus(ADMIN_COPY.removed(email));
      }
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const users = (listing?.users ?? []).filter((u) => filter.key === "all" || u.status === filter.key);
  const waiting = listing?.users.filter((u) => u.status === "waiting").length ?? 0;

  return (
    <>
      <ConsolePageHeader
        title={ADMIN_COPY.title}
        description={listing ? ADMIN_COPY.mode[listing.signup] : ADMIN_COPY.description}
      />

      <p role="status" aria-live="polite" className="text-muted empty:hidden">
        {status}
      </p>

      <ConsolePanel flush>
        <div className="border-b border-line px-5 py-3 console-narrow:px-4">
          <Tabs value={filter.key} onValueChange={(key) => setParams(key === ADMIN_FILTERS[0].key ? {} : { status: key })}>
            <TabsList className="scroll-fade-x max-w-full overflow-x-auto group-data-horizontal/tabs:h-9">
              {ADMIN_FILTERS.map((f) => (
                <TabsTrigger key={f.key} value={f.key} className="px-3">
                  {f.label}
                  {f.key === "waiting" && waiting > 0 && ` (${waiting})`}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {loadError ? (
          <ConsoleEmpty
            title={loadError}
            action={
              <ConsoleButton variant="secondary" onClick={() => void load()}>
                {ADMIN_COPY.retry}
              </ConsoleButton>
            }
          />
        ) : !listing ? (
          <ConsoleEmpty title={ADMIN_COPY.loading} />
        ) : users.length === 0 ? (
          <ConsoleEmpty title={ADMIN_COPY.empty[filter.key]} />
        ) : (
          <ConsoleTable columns={ADMIN_COLUMNS}>
            {users.map((user) => {
              const mine = busy?.email === user.email;
              return (
                <TableRow key={user.email}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{user.email}</span>
                      {user.admin && <ConsoleBadge value={ADMIN_COPY.admin} tone="neutral" />}
                    </span>
                    {user.name && <span className={consoleSub}>{user.name}</span>}
                    {user.approvedBy && <span className={consoleSub}>{ADMIN_COPY.approvedBy(user.approvedBy)}</span>}
                  </TableCell>
                  <TableCell className={consoleWideOnly}>{adminDate(user.createdAt)}</TableCell>
                  <TableCell className={consoleWideOnly}>{adminDate(user.lastSignInAt)}</TableCell>
                  <TableCell>
                    <ConsoleBadge value={user.status} tone={STATUS_TONE[user.status]} />
                  </TableCell>
                  {/* w-0: the column shrinks to its buttons. */}
                  <TableCell className="w-0">
                    {!user.admin && (
                      <span className="flex justify-end gap-2">
                        {user.status === "waiting" && (
                          <ConsoleButton disabled={busy !== null} onClick={() => void act(user.email, "approve")}>
                            {mine && busy.action === "approve" ? ADMIN_COPY.approving : ADMIN_COPY.approve}
                          </ConsoleButton>
                        )}
                        <ConsoleButton
                          variant="secondary"
                          disabled={busy !== null}
                          onClick={() => void act(user.email, "remove")}
                        >
                          {mine && busy.action === "remove" ? ADMIN_COPY.removing : ADMIN_COPY.remove}
                        </ConsoleButton>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </ConsoleTable>
        )}
      </ConsolePanel>
    </>
  );
}
