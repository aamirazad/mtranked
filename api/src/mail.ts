import nodemailer from "nodemailer";
import { env } from "./env";
import { reportError } from "./sentry";

const transport = env.smtpUrl ? nodemailer.createTransport(env.smtpUrl) : null;

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!transport) {
    console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    return;
  }
  try {
    await transport.sendMail({ from: env.mailFrom, to, subject, text, html });
  } catch (e) {
    reportError("[mail] send failed", e);
  }
}

// mt ranked's default theme (frontend/src/app.css). Inline styles only, since mail clients
// strip <style> and svg, so the logo is the app's wordmark set in text.
const wrap = (title: string, body: string, link: string, cta: string) => `
<div style="background:#141414;padding:40px 16px;font-family:'Roboto Mono',ui-monospace,monospace;color:#ededed">
  <div style="max-width:480px;margin:auto">
    <div style="margin-bottom:24px;line-height:1">
      <div style="font-family:Montserrat,'Lexend Deca',sans-serif;font-size:10px;letter-spacing:0.1em;color:#6e6e6e">competitive typing</div>
      <div style="font-family:Montserrat,'Lexend Deca',sans-serif;font-size:26px;color:#ededed">mt <span style="color:#f8c630">ranked</span></div>
    </div>
    <div style="background:#1f1f1f;border-radius:12px;padding:24px">
      <h2 style="margin:0 0 12px;font-weight:normal;font-size:20px;color:#ededed">${title}</h2>
      <p style="margin:0 0 20px;color:#6e6e6e;line-height:1.5">${body}</p>
      <a href="${link}" style="display:inline-block;background:#f8c630;color:#141414;padding:10px 18px;border-radius:8px;text-decoration:none">${cta}</a>
    </div>
    <p style="color:#6e6e6e;font-size:12px;margin-top:24px;word-break:break-all">If the button doesn't work: <a href="${link}" style="color:#6e6e6e">${link}</a></p>
  </div>
</div>`;

export function verificationEmail(to: string, token: string) {
  const link = `${env.appUrl}/verify?token=${token}`;
  return sendMail(
    to,
    "Verify your MT Ranked email",
    `Verify your email to unlock ranked: ${link}`,
    wrap("Verify your email", "Verifying your email makes you eligible to play ranked.", link, "Verify email"),
  );
}

export function resetEmail(to: string, token: string) {
  const link = `${env.appUrl}/reset?token=${token}`;
  return sendMail(
    to,
    "Reset your MT Ranked password",
    `Reset your password (valid for 30 minutes): ${link}`,
    wrap(
      "Reset your password",
      "This link is valid for 30 minutes and can be used once.",
      link,
      "Choose a new password",
    ),
  );
}
