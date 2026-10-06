"use server";

import bcrypt from "bcryptjs";
import * as z from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/session";
import { checkVerificationCode, resendWait, sendVerificationCode } from "@/lib/otp";
import {
  LoginSchema,
  SignupSchema,
  VerifySchema,
  type AuthFormState,
  type VerifyFormState,
} from "@/lib/definitions";

// Compared against when the email is unknown, so a miss takes as long as a wrong password.
const DUMMY_HASH = "$2b$12$Pup8q8iDEQRAuA9O6o.NMuMESMrFuljlYfDaat3STlwGgqe9r6Tsu";

const verifyUrl = (email: string, sendFailed = false) =>
  `/verify?email=${encodeURIComponent(email)}${sendFailed ? "&sent=0" : ""}`;

// Emails a code, reporting failure instead of throwing so the user can still reach /verify and resend.
async function trySendCode(user: { id: string; name: string; email: string }) {
  try {
    await sendVerificationCode(user);
    return true;
  } catch (e) {
    console.error("[mail] failed to send verification code", e);
    return false;
  }
}

export async function login(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, email: String(formData.get("email") ?? "") };
  }

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true, isActive: true, emailVerifiedAt: true },
  });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !ok) return { message: "Wrong email or password.", email };
  if (!user.isActive) return { message: "This account has been disabled.", email };

  if (!user.emailVerifiedAt) {
    // keep an existing fresh code rather than spamming a new one on every login attempt
    const sent = (await resendWait(user.id)) > 0 || (await trySendCode(user));
    redirect(verifyUrl(user.email, !sent));
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  redirect("/");
}

export async function signup(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: formData.get("password"),
  };
  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, name: raw.name, email: raw.email };
  }

  const { name, email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    // an unverified owner can log in with their password to get a new code
    return { errors: { email: ["An account with this email already exists. Try logging in."] }, name, email };
  }

  const user = await db.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 12) },
    select: { id: true, name: true, email: true },
  });
  const sent = await trySendCode(user);
  redirect(verifyUrl(user.email, !sent));
}

// Checks the emailed code; on success marks the email verified and logs the user in.
export async function verifyEmail(_state: VerifyFormState, formData: FormData): Promise<VerifyFormState> {
  const parsed = VerifySchema.safeParse({ email: formData.get("email"), code: formData.get("code") });
  if (!parsed.success) return { error: "Enter the 6-digit code from the email." };

  const { email, code } = parsed.data;
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, isActive: true, emailVerifiedAt: true },
  });
  if (!user || !user.isActive) return { error: "That code is invalid or has expired." };
  if (user.emailVerifiedAt) return { info: "This email is already verified. Log in instead." };

  const result = await checkVerificationCode(user.id, code);
  if (result === "wrong") return { error: "That code isn't right. Check the email and try again." };
  if (result === "expired") return { error: "That code has expired. Send a new one." };
  if (result === "locked") return { error: "Too many wrong tries. Send a new code." };

  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() } });
  await createSession(user.id);
  redirect("/");
}

export async function resendCode(_state: VerifyFormState, formData: FormData): Promise<VerifyFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true, emailVerifiedAt: true },
  });
  // same reply whether or not the account exists, so this can't be used to probe emails
  const done: VerifyFormState = { info: "If that account needs verifying, a new code is on its way." };
  if (!user || !user.isActive || user.emailVerifiedAt) return done;

  const wait = await resendWait(user.id);
  if (wait > 0) return { error: `Please wait ${wait}s before asking for another code.` };

  return (await trySendCode(user)) ? done : { error: "Couldn't send the email right now. Try again shortly." };
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
