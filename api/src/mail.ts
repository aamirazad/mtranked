import nodemailer from "nodemailer";
import { env } from "./env";

const transport = env.smtpUrl ? nodemailer.createTransport(env.smtpUrl) : null;

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!transport) {
    console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    return;
  }
  try {
    await transport.sendMail({ from: env.mailFrom, to, subject, text, html });
  } catch (e) {
    console.error("[mail] send failed", e);
  }
}

const wrap = (title: string, body: string, link: string, cta: string) => `
<div style="background:#323437;padding:32px;font-family:Roboto Mono,monospace;color:#d1d0c5">
  <div style="max-width:480px;margin:auto">
    <div style="color:#e2b714;font-size:20px;margin-bottom:16px">mt ranked</div>
    <h2 style="font-weight:normal">${title}</h2>
    <p style="color:#a6a6a6">${body}</p>
    <a href="${link}" style="display:inline-block;background:#e2b714;color:#323437;padding:10px 18px;border-radius:8px;text-decoration:none">${cta}</a>
    <p style="color:#646669;font-size:12px;margin-top:24px">If the button doesn't work: ${link}</p>
  </div>
</div>`;

export function verificationEmail(to: string, token: string) {
  const link = `${env.appUrl}/verify?token=${token}`;
  return sendMail(
    to,
    "Verify your MT Ranked email",
    `Verify your email to unlock ranked: ${link}`,
    wrap("Verify your email", "One click and you're ready for ranked.", link, "Verify email"),
  );
}

export function resetEmail(to: string, token: string) {
  const link = `${env.appUrl}/reset?token=${token}`;
  return sendMail(
    to,
    "Reset your MT Ranked password",
    `Reset your password (valid for 30 minutes): ${link}`,
    wrap("Reset your password", "This link is valid for 30 minutes and can be used once.", link, "Choose a new password"),
  );
}
