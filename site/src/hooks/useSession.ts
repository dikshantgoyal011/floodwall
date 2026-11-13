import { useCallback, useEffect, useState } from "react";
import { authClient } from "../helpers/auth";
import type { AuthSession, AuthUser } from "../types/auth";

const toSession = (user: AuthUser | null): AuthSession => (user ? { status: "signedIn", user } : { status: "signedOut" });

/**
 * Who is signed in, read when the page opens and again on `refresh`. When the service can't be
 * asked, the session is "unavailable", not signed out: the cookie may still be good.
 */
export function useSession() {
  const [session, setSession] = useState<AuthSession>({ status: "loading" });

  useEffect(() => {
    let live = true;
    authClient.getUser().then(
      (user) => live && setSession(toSession(user)),
      () => live && setSession({ status: "unavailable" }),
    );
    return () => {
      live = false;
    };
  }, []);

  // Asks again, e.g. whether a waiting account has been approved. If the
  // service can't be asked, it throws and the session stays as it was.
  const refresh = useCallback(async () => {
    const user = await authClient.getUser();
    setSession(toSession(user));
    return user;
  }, []);

  // Renames the account (an empty name clears it). Throws, with the service's
  // reason, if it couldn't; the session stays as it was.
  const updateProfile = useCallback(async (name: string) => {
    setSession(toSession(await authClient.updateProfile(name)));
  }, []);

  // Throws if the session could not be ended; the page stays signed in.
  const signOut = useCallback(async () => {
    await authClient.signOut();
    setSession({ status: "signedOut" });
  }, []);

  return { session, refresh, updateProfile, signOut };
}
