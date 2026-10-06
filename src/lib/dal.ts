import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { SESSION_COOKIE, hashToken } from "@/lib/session";

export type CurrentUser = { id: string; name: string; email: string; role: Role };

// The secure check: the cookie token must match a live session row for an active user.
// Memoised per request so layouts, pages and actions can all call it freely.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
    },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  const { id, name, email, role } = session.user;
  return { id, name, email, role };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") redirect("/");
  return user;
}
