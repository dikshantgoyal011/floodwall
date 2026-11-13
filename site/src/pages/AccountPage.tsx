import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { AuthPage } from "../components/auth/AuthPage";
import { SessionUnavailable } from "../components/auth/SessionUnavailable";
import { ButtonLink } from "../components/shared/ButtonLink";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { AUTH_COPY, AUTH_PATHS, NAME_MAX_LENGTH } from "../constants/auth";
import { CONSOLE_PATHS } from "../constants/console";
import { loginPath } from "../helpers/auth";
import { useSession } from "../hooks/useSession";
import { authCard, pillOutline } from "../styles/classes";
import type { AuthUser } from "../types/auth";

const COPY = AUTH_COPY.account;

export function AccountPage() {
  const { session, refresh, updateProfile, signOut } = useSession();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState("");

  if (session.status === "loading") return null;
  if (session.status === "unavailable") return <SessionUnavailable onRetry={refresh} />;
  if (session.status === "signedOut" && !leaving) return <Navigate to={loginPath(AUTH_PATHS.account)} replace />;
  if (session.status === "signedIn" && session.user.waiting) return <Navigate to={AUTH_PATHS.waitlist} replace />;

  async function onSignOut() {
    setLeaving(true);
    setStatus("");
    try {
      await signOut();
    } catch {
      setLeaving(false);
      return setStatus(AUTH_COPY.signOutFailed);
    }
    navigate(AUTH_PATHS.login, { replace: true });
  }

  return (
    <AuthPage title={COPY.title} lead={COPY.lead}>
      <Card className={authCard}>
        <p>
          {COPY.signedInAs}{" "}
          <strong className="text-ink">{session.status === "signedIn" ? session.user.email : ""}</strong>
        </p>
        <p className="text-sm text-muted">{COPY.session}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={CONSOLE_PATHS.overview} size="sm">
            {COPY.console}
          </ButtonLink>
          <Button type="button" className={pillOutline} disabled={leaving} onClick={() => void onSignOut()}>
            {leaving ? COPY.signingOut : COPY.signOut}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
          {status}
        </p>
      </Card>
      {session.status === "signedIn" && <NameForm user={session.user} onSave={updateProfile} />}
    </AuthPage>
  );
}

/** The account's name: shown in the header in place of the address, and cleared by saving it empty. */
function NameForm({ user, onSave }: { user: AuthUser; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(user.name ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus("");
    try {
      await onSave(name);
      const cleared = !name.trim();
      if (cleared) setName("");
      setStatus(cleared ? COPY.nameCleared : COPY.nameSaved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : AUTH_COPY.service.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <Label className="text-sm font-medium text-ink" htmlFor="account-name">
        {COPY.nameLabel}
      </Label>
      <p id="account-name-hint" className="text-sm text-muted">
        {COPY.nameHint}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id="account-name"
          name="name"
          className="h-11 min-w-0 flex-1 basis-56 rounded-none border-line-strong bg-surface px-3.5 text-base text-ink md:text-base focus-visible:border-ink focus-visible:ring-0"
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          aria-describedby="account-name-hint"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" className={pillOutline} aria-disabled={saving || undefined}>
          {saving ? COPY.savingName : COPY.saveName}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
        {status}
      </p>
    </form>
  );
}
