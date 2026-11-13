import { useState } from "react";
import { AUTH_COPY } from "../../constants/auth";
import { authCard, pillSolid } from "../../styles/classes";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { AuthPage } from "./AuthPage";

const COPY = AUTH_COPY.unavailable;

/**
 * Shown in place of a signed-in page when the sign-in service couldn't say who is signed in. The
 * session may well be fine, so this asks again instead of sending the reader to sign in.
 */
export function SessionUnavailable({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function retry() {
    setBusy(true);
    setStatus("");
    try {
      // Once the service answers, the page shows what it says instead of this.
      await onRetry();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : AUTH_COPY.service.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={COPY.title} lead={COPY.lead}>
      <Card className={authCard}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={pillSolid} disabled={busy} onClick={() => void retry()}>
            {busy ? COPY.retrying : COPY.retry}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
          {status}
        </p>
      </Card>
    </AuthPage>
  );
}
