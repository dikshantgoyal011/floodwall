import { Link, Navigate, useSearchParams } from "react-router";
import { AuthCodeForm } from "../components/auth/AuthCodeForm";
import { AuthPage } from "../components/auth/AuthPage";
import { AUTH_COPY, AUTH_PATHS, NEXT_PARAM } from "../constants/auth";
import { safeNext } from "../helpers/auth";
import { useSession } from "../hooks/useSession";

const COPY = AUTH_COPY.signup;

export function SignupPage() {
  const { session } = useSession();
  const [params] = useSearchParams();

  if (session.status === "signedIn") return <Navigate to={safeNext("signup", params.get(NEXT_PARAM))} replace />;

  return (
    <AuthPage kicker={COPY.kicker} title={COPY.title} lead={COPY.lead}>
      <p>{COPY.note}</p>
      <AuthCodeForm page="signup" />
      <p className="text-sm text-muted">{COPY.terms}</p>
      <p>
        {COPY.switchPrompt} <Link to={{ pathname: AUTH_PATHS.login, search: params.toString() }}>{COPY.switchLink}</Link>.
      </p>
    </AuthPage>
  );
}
