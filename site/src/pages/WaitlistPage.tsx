import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { AuthPage } from "../components/auth/AuthPage";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { AUTH_COPY, AUTH_PATHS } from "../constants/auth";
import { CONSOLE_PATHS } from "../constants/console";
import { loginPath } from "../helpers/auth";
import { useSession } from "../hooks/useSession";
import { authCard, pillOutline, pillSolid } from "../styles/classes";

const COPY = AUTH_COPY.waitlist;

/**
 * Where a waiting account lands instead of the console, until an admin
 * approves it. Anyone else is sent on: to sign in, or to the console.
 */
export function WaitlistPage() {
  const { session, refresh, signOut } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"check" | "leave" | null>(null);
  const [status, setStatus] = useState("");

  if (session.status === "loading") return null;
  if (session.status === "signedOut" && busy !== "leave") return <Navigate to={loginPath(CONSOLE_PATHS.overview)} replace />;
  if (session.status === "signedIn" && !session.user.waiting) return <Navigate to={CONSOLE_PATHS.overview} replace />;

  async function onCheck() {
    setBusy("check");
    setStatus("");
    const user = await refresh();
    setBusy(null);
    // Approved or signed out, the redirects above take over.
    if (user?.waiting) setStatus(COPY.stillWaiting);
  }

  async function onSignOut() {
    setBusy("leave");
    setStatus("");
    try {
      await signOut();
    } catch {
      setBusy(null);
      return setStatus(AUTH_COPY.signOutFailed);
    }
    navigate(AUTH_PATHS.login, { replace: true });
  }

  return (
    <AuthPage kicker={COPY.kicker} title={COPY.title} lead={COPY.lead}>
      <Card className={authCard}>
        <p>
          {COPY.willEmail[0]}
          <strong className="text-ink">{session.status === "signedIn" ? session.user.email : ""}</strong>
          {COPY.willEmail[1]}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={pillSolid} disabled={busy !== null} onClick={() => void onCheck()}>
            {busy === "check" ? COPY.checking : COPY.check}
          </Button>
          <Button type="button" className={pillOutline} disabled={busy !== null} onClick={() => void onSignOut()}>
            {busy === "leave" ? AUTH_COPY.account.signingOut : AUTH_COPY.signOut}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
          {status}
        </p>
      </Card>
    </AuthPage>
  );
}
