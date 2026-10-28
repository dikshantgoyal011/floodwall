import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { AuthPage } from "../components/auth/AuthPage";
import { ButtonLink } from "../components/shared/ButtonLink";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { AUTH_COPY, AUTH_PATHS } from "../constants/auth";
import { CONSOLE_PATHS } from "../constants/console";
import { loginPath } from "../helpers/auth";
import { useSession } from "../hooks/useSession";
import { authCard, pillOutline } from "../styles/classes";

const COPY = AUTH_COPY.account;

export function AccountPage() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  if (session.status === "loading") return null;
  if (session.status === "signedOut" && !leaving) return <Navigate to={loginPath(AUTH_PATHS.account)} replace />;

  async function onSignOut() {
    setLeaving(true);
    await signOut();
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
      </Card>
    </AuthPage>
  );
}
