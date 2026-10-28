import { Link, Navigate, useSearchParams } from "react-router";
import { AuthCodeForm } from "../components/auth/AuthCodeForm";
import { AuthPage } from "../components/auth/AuthPage";
import { AUTH_COPY, AUTH_PATHS, NEXT_PARAM } from "../constants/auth";
import { safeNext } from "../helpers/auth";
import { useSession } from "../hooks/useSession";

const COPY = AUTH_COPY.login;

export function LoginPage() {
  const { session } = useSession();
  const [params] = useSearchParams();

  if (session.status === "signedIn") return <Navigate to={safeNext("login", params.get(NEXT_PARAM))} replace />;

  return (
    <AuthPage title={COPY.title} lead={COPY.lead}>
      <AuthCodeForm page="login" />
      <p>
        {COPY.switchPrompt} <Link to={{ pathname: AUTH_PATHS.signup, search: params.toString() }}>{COPY.switchLink}</Link>.{" "}
        {COPY.switchNote}
      </p>
    </AuthPage>
  );
}
