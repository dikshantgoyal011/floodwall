// The sign-in service's admin calls (api/src/admin.ts). The service checks
// that the session is an admin's; the page only decides what to show.

import type { AdminAccount, SignupMode } from "../types/auth";
import { callService } from "./auth";

export const adminClient = {
  list: () => callService<{ signup: SignupMode; users: AdminAccount[] }>("/admin/users"),
  approve: (email: string) => callService<{ approved: true; emailed: boolean }>("/admin/approve", { email }),
  remove: (email: string) => callService<{ removed: true }>("/admin/remove", { email }),
};
