import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;

// Salted with the user id so the same code for two users never hashes the same.
function hashCode(userId: string, code: string) {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

// Seconds left before another code may be sent (0 = can send now).
export async function resendWait(userId: string) {
  const last = await db.emailOtp.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!last) return 0;
  const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
}

// Replaces any previous code for the user and emails a fresh one.
export async function sendVerificationCode(user: { id: string; name: string; email: string }) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  await db.$transaction([
    db.emailOtp.deleteMany({ where: { userId: user.id } }),
    db.emailOtp.create({
      data: {
        userId: user.id,
        codeHash: hashCode(user.id, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);

  await sendMail(
    user.email,
    `${code} is your Goal Galaxy code`,
    `Hi ${user.name},\n\nYour Goal Galaxy verification code is ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you didn't sign up, ignore this email.`,
    `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;color:#1a1d33">
      <h2 style="font-family:Georgia,serif;font-weight:normal">Goal Galaxy</h2>
      <p>Hi ${escapeHtml(user.name)},</p>
      <p>Your verification code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${code}</p>
      <p style="color:#666">It expires in ${CODE_TTL_MINUTES} minutes. If you didn't sign up, ignore this email.</p>
    </div>`,
  );
}

export type CodeCheck = "ok" | "wrong" | "expired" | "locked";

// Checks a submitted code, counting the attempt. A correct code is consumed.
export async function checkVerificationCode(userId: string, code: string): Promise<CodeCheck> {
  const otp = await db.emailOtp.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.expiresAt < new Date()) return "expired";
  if (otp.attempts >= MAX_ATTEMPTS) return "locked";

  const match = timingSafeEqual(Buffer.from(otp.codeHash, "hex"), Buffer.from(hashCode(userId, code), "hex"));
  if (!match) {
    const { attempts } = await db.emailOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return attempts >= MAX_ATTEMPTS ? "locked" : "wrong";
  }

  await db.emailOtp.deleteMany({ where: { userId } });
  return "ok";
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
