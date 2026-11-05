// The Worker: routes each request, lets the allowed sites read the answer,
// and sweeps expired rows on its daily schedule.

import { approveUser, listUsers, removeUser } from "./admin";
import { currentSession, sendCode, signOut, sweep, verifyCode } from "./auth";
import type { Env } from "./env";
import { allowedOrigin, HttpError, json, preflight, withCors } from "./http";
import { MESSAGES } from "./rules";

async function route(request: Request, env: Env, origin: string | null) {
  const now = Date.now();
  const { pathname } = new URL(request.url);
  // Only the site's own pages may change anything: a POST from any other
  // origin, or with none, is refused before it is read.
  if (request.method === "POST" && !origin) throw new HttpError(403, MESSAGES.foreignOrigin);

  switch (`${request.method} ${pathname}`) {
    case "POST /auth/code":
      return sendCode(request, env, now);
    case "POST /auth/verify":
      return verifyCode(request, env, now);
    case "GET /auth/session":
      return currentSession(request, env, now);
    case "POST /auth/signout":
      return signOut(request, env);
    case "GET /admin/users":
      return listUsers(request, env, now);
    case "POST /admin/approve":
      return approveUser(request, env, now, origin!);
    case "POST /admin/remove":
      return removeUser(request, env, now);
  }
  throw new HttpError(404, MESSAGES.notFound);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") return preflight(origin);
    let response: Response;
    try {
      response = await route(request, env, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status, error.headers);
      } else {
        console.error("sign-in failed", error);
        response = json({ error: MESSAGES.broken }, 500);
      }
    }
    return withCors(response, origin);
  },

  async scheduled(_controller, env) {
    await sweep(env.DB, Date.now());
  },
} satisfies ExportedHandler<Env>;
