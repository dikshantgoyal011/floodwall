import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AUTH_COPY, CODE_LENGTH, NEXT_PARAM, RESEND_COOLDOWN_MS } from "../../constants/auth";
import { authClient, safeNext } from "../../helpers/auth";
import { authCard, authNote, pillOutline, pillSolid } from "../../styles/classes";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const COPY = AUTH_COPY.form;
const FIELD = "flex flex-col gap-2";
const LABEL = "text-sm font-semibold text-ink";
const INPUT = "h-11 rounded-control bg-white px-3.5 text-base md:text-base";

type Busy = "send" | "resend" | "verify" | null;

/**
 * Sign-in in two steps on one card: an email address, then the six-digit code
 * sent to it. Shared by /login and /signup, which differ only in where a new
 * session goes next.
 */
export function AuthCodeForm({ page }: { page: "login" | "signup" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [demoCode, setDemoCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const codeShown = sentTo !== "";

  // Each step puts the cursor where the next thing is typed.
  useEffect(() => {
    (codeShown ? codeInput : emailInput).current?.focus();
  }, [codeShown]);

  async function run(kind: Exclude<Busy, null>, work: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setStatus("");
    try {
      await work();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function send(to: string) {
    const { code } = await authClient.sendCode(to);
    setDemoCode(code);
    setSentTo(to);
    setSentAt(Date.now());
  }

  function onSendCode(event: FormEvent) {
    event.preventDefault();
    void run("send", () => send(email.trim()));
  }

  function onResend() {
    const wait = Math.ceil((sentAt + RESEND_COOLDOWN_MS - Date.now()) / 1000);
    if (wait > 0) return setStatus(COPY.wait(wait));
    void run("resend", async () => {
      await send(sentTo);
      setCode("");
      setStatus(COPY.resent(sentTo));
      codeInput.current?.focus();
    });
  }

  function onVerify(event: FormEvent) {
    event.preventDefault();
    void run("verify", async () => {
      await authClient.verifyCode(sentTo, code);
      navigate(safeNext(page, params.get(NEXT_PARAM)), { replace: true });
    });
  }

  function onRestart() {
    setSentTo("");
    setCode("");
    setDemoCode("");
    setStatus(COPY.restarted);
  }

  return (
    <Card className={authCard}>
      {codeShown ? (
        <form className="flex flex-col gap-5" onSubmit={onVerify}>
          <p className="text-base leading-body text-ink-soft">
            {COPY.sentTo[0]}
            <strong className="text-ink">{sentTo}</strong>
            {COPY.sentTo[1]}
          </p>
          <p className={authNote}>{COPY.demo(demoCode)}</p>
          <div className={FIELD}>
            <Label className={LABEL} htmlFor="code">
              {COPY.codeLabel}
            </Label>
            <Input
              ref={codeInput}
              id="code"
              name="code"
              className={`${INPUT} font-mono tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`[0-9]{${CODE_LENGTH}}`}
              maxLength={CODE_LENGTH}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className={pillSolid} disabled={busy !== null}>
              {busy === "verify" ? COPY.verifying : COPY.verify}
            </Button>
            <Button type="button" className={pillOutline} disabled={busy !== null} onClick={onResend}>
              {busy === "resend" ? COPY.resending : COPY.resend}
            </Button>
            <Button type="button" className={pillOutline} disabled={busy !== null} onClick={onRestart}>
              {COPY.restart}
            </Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={onSendCode}>
          <div className={FIELD}>
            <Label className={LABEL} htmlFor="email">
              {COPY.emailLabel}
            </Label>
            <Input
              ref={emailInput}
              id="email"
              name="email"
              type="email"
              className={INPUT}
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex">
            <Button type="submit" className={pillSolid} disabled={busy !== null}>
              {busy === "send" ? COPY.sending : COPY.send}
            </Button>
          </div>
        </form>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
        {status}
      </p>
    </Card>
  );
}
