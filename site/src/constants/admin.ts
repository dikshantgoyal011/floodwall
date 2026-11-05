// Copy for the admin page at /app/admin, where admins approve the waitlist.

import type { SignupMode } from "../types/auth";

export const ADMIN_COLUMNS = ["Email", "Joined", "Last sign-in", "Status", ""];

export const ADMIN_FILTERS = [
  { key: "waiting", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
] as const;

export const ADMIN_COPY = {
  title: "Admin",
  description: "Who has signed up, and who is waiting to be let in.",
  /** How sign-up works now, by the service's SIGNUP_MODE. */
  mode: {
    waitlist: "Sign-up is on the waitlist: new accounts wait here until you approve them.",
    open: "Sign-up is open: anyone who signs in can use the console.",
  } satisfies Record<SignupMode, string>,
  loading: "Loading accounts…",
  empty: { waiting: "Nobody is waiting.", approved: "No approved accounts yet.", all: "No accounts yet." },
  approve: "Approve",
  approving: "Approving…",
  remove: "Remove",
  removing: "Removing…",
  confirmRemove: (email: string) =>
    `Remove ${email}? They are signed out everywhere. Signing in again puts them back on the waitlist.`,
  approved: (email: string) => `Approved ${email}. We emailed them.`,
  approvedNoEmail: (email: string) =>
    `Approved ${email}, but the email to them could not be sent. They can sign in now.`,
  removed: (email: string) => `Removed ${email}.`,
  admin: "admin",
  /** Under an approved account: who approved it. */
  approvedBy: (by: string) => `Approved by ${by}`,
  retry: "Try again",
};

/** "4 Nov 2026, 14:05", in the reader's time zone. */
export function adminDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
