import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { AUTH_COPY, AUTH_PATHS } from "../../constants/auth";
import { CONSOLE_PATHS } from "../../constants/console";
import { accountInitials, accountLabel } from "../../helpers/auth";
import { useDismiss } from "../../hooks/useDismiss";
import { useSession } from "../../hooks/useSession";
import { panelMotion } from "../../lib/panel";
import { Icon } from "./Icon";

const COPY = AUTH_COPY.header;

/**
 * The header's account slot, beside the GitHub button: Sign in for a visitor, or the signed-in
 * account's initials and name (its address until it has one), with a menu of Account, Console and
 * Sign out. The landing page
 * is prerendered with no session, so until the service answers the slot holds its width and shows
 * nothing: someone signed in never sees Sign in flash by. If the service can't be asked, it offers
 * Sign in. Plain links, not router ones: the landing page renders without the router.
 */
export function HeaderAccount() {
  const { session, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState("");
  const slotRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const signInRef = useRef<HTMLAnchorElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const onBlur = useDismiss(open, close, slotRef, buttonRef);

  // Signing out from the menu replaces it with Sign in; the keyboard focus goes there, not to the page.
  const focusSignIn = useRef(false);
  useEffect(() => {
    if (session.status !== "signedOut" || !focusSignIn.current) return;
    focusSignIn.current = false;
    signInRef.current?.focus();
  }, [session.status]);

  async function onSignOut() {
    if (leaving) return;
    setLeaving(true);
    setStatus("");
    focusSignIn.current = true;
    try {
      await signOut();
      setOpen(false);
    } catch {
      focusSignIn.current = false;
      setStatus(AUTH_COPY.signOutFailed);
    } finally {
      setLeaving(false);
    }
  }

  if (session.status === "loading") return <div className="nav-account" data-state="loading" />;
  if (session.status !== "signedIn") {
    return (
      <div className="nav-account" data-state="signed-out">
        <a ref={signInRef} className="nav-sign-in" href={AUTH_PATHS.login}>
          {COPY.signIn}
        </a>
      </div>
    );
  }

  const { user } = session;
  return (
    <div className="nav-account" data-state="signed-in" ref={slotRef} onBlur={onBlur}>
      <button
        ref={buttonRef}
        className="nav-account-button"
        type="button"
        aria-label={COPY.menu(user.email, user.name)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((shown) => !shown)}
      >
        <span className="nav-avatar">{accountInitials(user)}</span>
        <span className="nav-account-name">{accountLabel(user)}</span>
        <Icon icon={ArrowDown01Icon} size={16} className="nav-menu-chevron" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="nav-account-panel" id={panelId} {...panelMotion}>
            <p className="nav-account-who">
              {COPY.signedInAs} <strong>{accountLabel(user)}</strong>
              {user.name && <span className="nav-account-email">{user.email}</span>}
            </p>
            <ul className="nav-account-links">
              <li>
                <a href={AUTH_PATHS.account}>{COPY.account}</a>
              </li>
              <li>
                {/* A waiting account's console is the waitlist page, so the menu says so. */}
                {user.waiting ? (
                  <a href={AUTH_PATHS.waitlist}>{COPY.waitlist}</a>
                ) : (
                  <a href={CONSOLE_PATHS.overview}>{COPY.console}</a>
                )}
              </li>
              <li>
                {/* aria-disabled, not disabled: disabling the focused button would drop focus, and with
                    it the menu, before a failure could be shown in it. */}
                <button type="button" aria-disabled={leaving || undefined} onClick={() => void onSignOut()}>
                  {leaving ? COPY.signingOut : COPY.signOut}
                </button>
              </li>
            </ul>
            <p role="status" aria-live="polite" className="nav-account-status">
              {status}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
