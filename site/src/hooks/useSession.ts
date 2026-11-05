import { useCallback, useEffect, useState } from "react";
import { authClient } from "../helpers/auth";
import type { AuthSession, AuthUser } from "../types/auth";

const toSession = (user: AuthUser | null): AuthSession => (user ? { status: "signedIn", user } : { status: "signedOut" });

/** Who is signed in, read when the page opens and again on `refresh`. */
export function useSession() {
  const [session, setSession] = useState<AuthSession>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void authClient.getUser().then((user) => {
      if (live) setSession(toSession(user));
    });
    return () => {
      live = false;
    };
  }, []);

  // Asks again, e.g. whether a waiting account has been approved.
  const refresh = useCallback(async () => {
    const user = await authClient.getUser();
    setSession(toSession(user));
    return user;
  }, []);

  // Throws if the session could not be ended; the page stays signed in.
  const signOut = useCallback(async () => {
    await authClient.signOut();
    setSession({ status: "signedOut" });
  }, []);

  return { session, refresh, signOut };
}
