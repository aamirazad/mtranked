// Transactional email through Resend's HTTP API (the domain is verified there). When Resend
// refuses with 429 (daily/monthly quota or rate limit) and SMTP_PASSWORD is set, the message
// goes out through Mailgun's SMTP instead. With neither key (local dev) it's logged instead,
// link or code included.
import { env } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { reportError } from "./sentry";
import { smtpSend, type SmtpMessage } from "./smtp";

const SMTP_TIMEOUT_MS = 15_000;

class ResendLimited extends Error {}

async function sendResend(m: SmtpMessage) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
  });
  if (res.ok) return;
  const msg = `resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
  throw res.status === 429 ? new ResendLimited(msg) : new Error(msg);
}

async function sendSmtp(m: SmtpMessage) {
  // port 465 is TLS from the first byte (Workers can't open port 25)
  const socket = connect({ hostname: env.SMTP_HOST, port: 465 }, { secureTransport: "on", allowHalfOpen: false });
  const timer = setTimeout(() => socket.close(), SMTP_TIMEOUT_MS);
  try {
    await smtpSend(socket, env.SMTP_USER, env.SMTP_PASSWORD!, m);
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => {});
  }
}

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!env.RESEND_API_KEY && !env.SMTP_PASSWORD) {
    console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    return;
  }
  try {
    if (env.RESEND_API_KEY) {
      try {
        return await sendResend({ from: env.MAIL_FROM, to, subject, text, html });
      } catch (e) {
        if (!(e instanceof ResendLimited) || !env.SMTP_PASSWORD) throw e;
        console.warn("[mail] resend limited, falling back to smtp:", e.message);
      }
    }
    await sendSmtp({ from: env.SMTP_FROM, to, subject, text, html });
  } catch (e) {
    reportError("[mail] send failed", e);
  }
}

// mt ranked's default theme (frontend/src/app.css). Inline styles only, since mail clients
// strip <style> and svg, so the logo is the app's wordmark set in text.
const wrap = (title: string, body: string, action: string, footer = "") => `
<div style="background:#141414;padding:40px 16px;font-family:'Roboto Mono',ui-monospace,monospace;color:#ededed">
  <div style="max-width:480px;margin:auto">
    <div style="margin-bottom:24px;line-height:1">
      <div style="font-family:Montserrat,'Lexend Deca',sans-serif;font-size:10px;letter-spacing:0.1em;color:#6e6e6e">competitive typing</div>
      <div style="font-family:Montserrat,'Lexend Deca',sans-serif;font-size:26px;color:#ededed">mt <span style="color:#f8c630">ranked</span></div>
    </div>
    <div style="background:#1f1f1f;border-radius:12px;padding:24px">
      <h2 style="margin:0 0 12px;font-weight:normal;font-size:20px;color:#ededed">${title}</h2>
      <p style="margin:0 0 20px;color:#6e6e6e;line-height:1.5">${body}</p>
      ${action}
    </div>
    ${footer}
  </div>
</div>`;

const button = (link: string, cta: string) =>
  `<a href="${link}" style="display:inline-block;background:#f8c630;color:#141414;padding:10px 18px;border-radius:8px;text-decoration:none">${cta}</a>`;
const linkFallback = (link: string) =>
  `<p style="color:#6e6e6e;font-size:12px;margin-top:24px;word-break:break-all">If the button doesn't work: <a href="${link}" style="color:#6e6e6e">${link}</a></p>`;
const linkEmail = (title: string, body: string, link: string, cta: string) => wrap(title, body, button(link, cta), linkFallback(link));

export function verificationEmail(to: string, token: string) {
  const link = `${env.APP_URL}/verify?token=${token}`;
  return sendMail(
    to,
    "Verify your MT Ranked email",
    `Verify your email to unlock ranked: ${link}`,
    linkEmail("Verify your email", "Verifying your email makes you eligible to play ranked.", link, "Verify email"),
  );
}

export function resetEmail(to: string, token: string) {
  const link = `${env.APP_URL}/reset?token=${token}`;
  return sendMail(
    to,
    "Reset your MT Ranked password",
    `Reset your password (valid for 30 minutes): ${link}`,
    linkEmail("Reset your password", "This link is valid for 30 minutes and can be used once.", link, "Choose a new password"),
  );
}

export function codeEmail(to: string, code: string) {
  return sendMail(
    to,
    `${code} is your MT Ranked sign-in code`,
    `Your MT Ranked sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    wrap(
      "Your sign-in code",
      "Enter this code to sign in. It expires in 10 minutes. If you didn't ask for it, you can ignore this email.",
      `<div style="font-size:32px;letter-spacing:0.3em;color:#f8c630">${code}</div>`,
    ),
  );
}
