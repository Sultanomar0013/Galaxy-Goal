import "server-only";
import nodemailer from "nodemailer";

// SMTP settings come from .env. Without SMTP_HOST (e.g. local dev) nothing is sent and
// the message is printed to the server console instead, so sign-up can still be tested.
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!transport) {
    console.log(`\n[mail] SMTP not configured, would send to ${to}\n[mail] ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}
