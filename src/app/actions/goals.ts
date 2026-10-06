"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { GoalInput, goalInclude, goalsForUser, toData, toDTO, type GoalDTO } from "@/lib/goals";
import * as extras from "@/lib/goalExtras";
import { notifyFriends, touchSeen } from "@/lib/connections";

// Called from the galaxy engine. Every action re-checks the session and only touches the caller's goals
// (the rules for steps, notes, links and capsules are in lib/goalExtras.ts).

export async function listGoals(): Promise<GoalDTO[]> {
  const user = await requireUser();
  await touchSeen(user.id);
  return goalsForUser(user.id);
}

export async function saveGoal(input: unknown): Promise<{ goal: GoalDTO } | { error: string }> {
  const user = await requireUser();
  const parsed = GoalInput.safeParse(input);
  if (!parsed.success) return { error: "That goal has invalid values." };

  const { id } = parsed.data;
  const data = toData(parsed.data);
  const existing = await db.goal.findUnique({ where: { id }, select: { userId: true } });
  if (existing && existing.userId !== user.id) return { error: "Goal not found." };

  if (existing) await db.goal.update({ where: { id }, data });
  else await db.goal.create({ data: { ...data, id, userId: user.id } });
  await extras.setShares(user.id, id, data.limited ? parsed.data.sharedWith : []);
  await notifyFriends(user.id);
  const goal = await db.goal.findUniqueOrThrow({ where: { id }, include: goalInclude });
  return { goal: toDTO(goal, user.id) };
}

export async function deleteGoal(id: string): Promise<{ ok: true }> {
  const user = await requireUser();
  await db.goal.deleteMany({ where: { id: String(id), userId: user.id } });
  await notifyFriends(user.id);
  return { ok: true };
}

export async function addStep(goalId: string, title: string) {
  return extras.addStep(await requireUser(), goalId, title);
}
export async function updateStep(stepId: string, patch: { title?: string; done?: boolean }) {
  return extras.updateStep(await requireUser(), stepId, patch ?? {});
}
export async function deleteStep(stepId: string) {
  return extras.deleteStep(await requireUser(), stepId);
}
export async function suggestStep(goalId: string, title: string) {
  return extras.suggestStep(await requireUser(), goalId, title);
}
export async function decideStep(stepId: string, accept: boolean) {
  return extras.decideStep(await requireUser(), stepId, !!accept);
}
export async function linkGoals(fromId: string, toId: string) {
  return extras.linkGoals(await requireUser(), fromId, toId);
}
export async function unlinkGoals(fromId: string, toId: string) {
  return extras.unlinkGoals(await requireUser(), fromId, toId);
}
export async function addNote(goalId: string, text: string) {
  return extras.addNote(await requireUser(), goalId, text);
}
export async function deleteNote(noteId: string) {
  return extras.deleteNote(await requireUser(), noteId);
}
export async function markNotesRead(goalId: string) {
  return extras.markNotesRead(await requireUser(), goalId);
}
export async function setCapsule(goalId: string, text: string) {
  return extras.setCapsule(await requireUser(), goalId, text);
}
