// The emails the service sends, through Resend: the sign-in code, and the
// note that a waiting account was approved.

import type { Env } from "./env";
import { HttpError } from "./http";
import { CODE_TTL_MS, MESSAGES } from "./rules";

export const RESEND_URL = "https://api.resend.com/emails";

// Inline styles only: many mail apps drop <style> blocks. The colours and
// type are the site's.
const STYLE = {
  body: "margin:0;padding:32px 16px;background:#f7fbff;",
  card: "max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #e1e6ea;border-radius:12px;font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#080b0d;",
  brand: "margin:0 0 24px;font-family:'Instrument Serif',Georgia,serif;font-size:24px;line-height:1;",
  text: "margin:0 0 16px;font-size:16px;line-height:1.5;color:#4e5961;",
  code: "margin:0 0 24px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#080b0d;",
  button: "display:inline-block;margin:0 0 24px;padding:12px 20px;border-radius:999px;background:#080b0d;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;",
  small: "margin:0;font-size:14px;line-height:1.5;color:#667078;",
};

type Email = { subject: string; text: string; html: string };

function page(content: string) {
  return `<!doctype html><html><body style="${STYLE.body}"><div style="${STYLE.card}">
<p style="${STYLE.brand}">Floodwall</p>
${content}
</div></body></html>`;
}

/** The email for one code: subject, plain text and HTML, with nothing from the request in it but the code. */
export function codeEmail(code: string): Email {
  const lines = {
    lead: "Your Floodwall sign-in code is:",
    use: `It expires in ${CODE_TTL_MS / 60_000} minutes and works once. Enter it on the page where you asked for it.`,
    ignore: "If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.",
  };
  return {
    subject: `${code} is your Floodwall sign-in code`,
    text: `${lines.lead}\n\n${code}\n\n${lines.use}\n\n${lines.ignore}\n`,
    html: page(`<p style="${STYLE.text}">${lines.lead}</p>
<p style="${STYLE.code}">${code}</p>
<p style="${STYLE.text}">${lines.use}</p>
<p style="${STYLE.small}">${lines.ignore}</p>`),
  };
}

/**
 * The email to a waiting account once an admin approves it. `consoleUrl` is
 * the console on the site the admin approved from, one of ALLOWED_ORIGINS.
 */
export function approvedEmail(consoleUrl: string): Email {
  const lines = {
    lead: "Your Floodwall account is approved. You can open the console now.",
    open: "Open the console",
    signIn: "If you're signed out, sign in with this address and we'll email you a code.",
  };
  return {
    subject: "You're in: your Floodwall account is approved",
    text: `${lines.lead}\n\n${lines.open}: ${consoleUrl}\n\n${lines.signIn}\n`,
    html: page(`<p style="${STYLE.text}">${lines.lead}</p>
<a style="${STYLE.button}" href="${consoleUrl}">${lines.open}</a>
<p style="${STYLE.small}">${lines.signIn}</p>`),
  };
}

/** Sends `email` to `to`, or throws a 502 the reader can retry after. */
export async function sendEmail(env: Env, to: string, email: Email) {
  let response: Response;
  try {
    response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], ...email }),
    });
  } catch (error) {
    console.error("resend: unreachable", error);
    throw new HttpError(502, MESSAGES.notSent);
  }
  if (!response.ok) {
    // Resend's error says what was wrong (an unverified domain, a bad key)
    // without repeating the key.
    console.error("resend: refused", response.status, (await response.text()).slice(0, 500));
    throw new HttpError(502, MESSAGES.notSent);
  }
}

export function sendCodeEmail(env: Env, to: string, code: string) {
  return sendEmail(env, to, codeEmail(code));
}
