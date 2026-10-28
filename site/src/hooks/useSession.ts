import { useCallback, useEffect, useState } from "react";
import { authClient } from "../helpers/auth";
import type { AuthSession } from "../types/auth";

/** Who is signed in, read when the page opens. */
export function useSession() {
  const [session, setSession] = useState<AuthSession>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void authClient.getUser().then((user) => {
      if (live) setSession(user ? { status: "signedIn", user } : { status: "signedOut" });
    });
    return () => {
      live = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setSession({ status: "signedOut" });
  }, []);

  return { session, signOut };
}
