import "server-only";
import * as z from "zod";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { STEPS_MAX, visibleTo } from "@/lib/goals";
import { areConnected, connectionIds, isMentor, notifyFriends } from "@/lib/connections";
import { notifyOffline } from "@/lib/push";
import * as live from "@/lib/realtime";

// The parts of a goal that aren't saved with the goal form: steps (moons), mentors' suggestions,
// links between goals, guestbook notes and the time capsule. Each function acts for `me`.

type Result<T = object> = ({ ok: true } & T) | { error: string };
const Title = z.string().trim().min(1).max(200);
const NoteText = z.string().trim().min(1).max(280);
const CAPSULE_MAX = 5000;
const PENDING_MAX = 10;
const LINKS_MAX = 10;

async function ownGoal(me: CurrentUser, goalId: string) {
  return db.goal.findFirst({ where: { id: String(goalId), userId: me.id }, select: { id: true, name: true, userId: true } });
}

// A goal `me` may look at: their own, or a connection's that's shared with them.
async function viewableGoal(me: CurrentUser, goalId: string) {
  const g = await db.goal.findUnique({ where: { id: String(goalId) }, select: { id: true, name: true, userId: true } });
  if (!g) return null;
  if (g.userId === me.id) return g;
  const shared = await db.goal.count({ where: { id: g.id, ...visibleTo(me.id) } });
  return shared && (await areConnected(me.id, g.userId)) ? g : null;
}

// The owner's own tabs reload their goals; connections reload what they can see.
async function changed(ownerId: string) {
  live.publish([ownerId], "goals", {});
  await notifyFriends(ownerId);
}

// ---------- steps ----------

async function stepOf(me: CurrentUser, stepId: string) {
  return db.goalStep.findFirst({ where: { id: String(stepId), goal: { userId: me.id } }, select: { id: true, goalId: true, pending: true } });
}

async function nextPosition(goalId: string) {
  const last = await db.goalStep.aggregate({ where: { goalId }, _max: { position: true } });
  return (last._max.position ?? -1) + 1;
}

export async function addStep(me: CurrentUser, goalId: string, title: unknown): Promise<Result> {
  const g = await ownGoal(me, goalId);
  const t = Title.safeParse(title);
  if (!g || !t.success) return { error: "Give the step a name (up to 200 characters)." };
  if ((await db.goalStep.count({ where: { goalId: g.id, pending: false } })) >= STEPS_MAX) return { error: `A goal can have up to ${STEPS_MAX} steps.` };
  await db.goalStep.create({ data: { goalId: g.id, title: t.data, position: await nextPosition(g.id) } });
  await changed(me.id);
  return { ok: true };
}

export async function updateStep(me: CurrentUser, stepId: string, patch: { title?: unknown; done?: unknown }): Promise<Result> {
  const s = await stepOf(me, stepId);
  if (!s || s.pending) return { error: "That step no longer exists." };
  const data: { title?: string; doneAt?: Date | null } = {};
  if (patch.title !== undefined) {
    const t = Title.safeParse(patch.title);
    if (!t.success) return { error: "Give the step a name (up to 200 characters)." };
    data.title = t.data;
  }
  if (patch.done !== undefined) data.doneAt = patch.done ? new Date() : null;
  await db.goalStep.update({ where: { id: s.id }, data });
  await changed(me.id);
  return { ok: true };
}

export async function deleteStep(me: CurrentUser, stepId: string): Promise<Result> {
  const s = await stepOf(me, stepId);
  if (s) await db.goalStep.delete({ where: { id: s.id } });
  await changed(me.id);
  return { ok: true };
}

// A mentor proposes a step; it waits for the owner.
export async function suggestStep(me: CurrentUser, goalId: string, title: unknown): Promise<Result> {
  const g = await viewableGoal(me, goalId);
  const t = Title.safeParse(title);
  if (!g || g.userId === me.id) return { error: "You can only suggest steps for someone else's goal." };
  if (!(await isMentor(me.id, g.userId))) return { error: "Only their mentors can suggest steps." };
  if (!t.success) return { error: "Give the step a name (up to 200 characters)." };
  if ((await db.goalStep.count({ where: { goalId: g.id, pending: true } })) >= PENDING_MAX) return { error: "This goal already has plenty of suggestions waiting." };
  await db.goalStep.create({ data: { goalId: g.id, title: t.data, position: await nextPosition(g.id), pending: true, suggestedById: me.id } });
  live.publish([g.userId], "goals", { suggestion: { from: me.name, goal: g.name } });
  await notifyOffline([g.userId], { title: `${me.name} suggested a step`, body: `For "${g.name}": ${t.data}`, tag: "suggest-" + g.id });
  return { ok: true };
}

export async function decideStep(me: CurrentUser, stepId: string, accept: boolean): Promise<Result> {
  const s = await stepOf(me, stepId);
  if (!s || !s.pending) return { error: "That suggestion was already decided." };
  if (accept) {
    if ((await db.goalStep.count({ where: { goalId: s.goalId, pending: false } })) >= STEPS_MAX) return { error: `A goal can have up to ${STEPS_MAX} steps.` };
    await db.goalStep.update({ where: { id: s.id }, data: { pending: false, position: await nextPosition(s.goalId) } });
  } else await db.goalStep.delete({ where: { id: s.id } });
  await changed(me.id);
  return { ok: true };
}

// ---------- links ----------

export async function linkGoals(me: CurrentUser, fromId: string, toId: string): Promise<Result> {
  if (String(fromId) === String(toId)) return { error: "Pick a different goal to link to." };
  const [a, b] = await Promise.all([ownGoal(me, fromId), ownGoal(me, toId)]);
  if (!a || !b) return { error: "Both goals must be yours." };
  if ((await db.goalLink.count({ where: { fromId: a.id } })) >= LINKS_MAX) return { error: `A goal can feed into up to ${LINKS_MAX} others.` };
  // one line per pair, whichever way it was drawn
  const exists = await db.goalLink.count({ where: { OR: [{ fromId: a.id, toId: b.id }, { fromId: b.id, toId: a.id }] } });
  if (!exists) await db.goalLink.create({ data: { fromId: a.id, toId: b.id } });
  await changed(me.id);
  return { ok: true };
}

export async function unlinkGoals(me: CurrentUser, fromId: string, toId: string): Promise<Result> {
  await db.goalLink.deleteMany({
    where: {
      from: { userId: me.id },
      OR: [{ fromId: String(fromId), toId: String(toId) }, { fromId: String(toId), toId: String(fromId) }],
    },
  });
  await changed(me.id);
  return { ok: true };
}

// ---------- guestbook notes ----------

export async function addNote(me: CurrentUser, goalId: string, text: unknown): Promise<Result> {
  const g = await viewableGoal(me, goalId);
  const t = NoteText.safeParse(text);
  if (!g) return { error: "You can't leave a note on that goal." };
  if (!t.success) return { error: "Notes can be up to 280 characters." };
  if (!live.allow(`note:${me.id}`, 3000)) return { error: "Slow down a little between notes." };
  await db.goalNote.create({ data: { goalId: g.id, authorId: me.id, text: t.data, readAt: g.userId === me.id ? new Date() : null } });
  if (g.userId !== me.id) {
    live.publish([g.userId], "goals", { note: { from: me.name, goal: g.name } });
    await notifyOffline([g.userId], { title: `${me.name} left you a note`, body: `On "${g.name}": ${t.data}`, tag: "note-" + g.id });
  }
  await notifyFriends(g.userId);
  return { ok: true };
}

// The author, or the goal's owner, can remove a note.
export async function deleteNote(me: CurrentUser, noteId: string): Promise<Result> {
  const n = await db.goalNote.findFirst({
    where: { id: String(noteId), OR: [{ authorId: me.id }, { goal: { userId: me.id } }] },
    select: { id: true, goal: { select: { userId: true } } },
  });
  if (!n) return { error: "That note is already gone." };
  await db.goalNote.delete({ where: { id: n.id } });
  await changed(n.goal.userId);
  return { ok: true };
}

export async function markNotesRead(me: CurrentUser, goalId: string): Promise<Result> {
  await db.goalNote.updateMany({ where: { goalId: String(goalId), goal: { userId: me.id }, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}

// ---------- time capsule ----------

// Writing replaces any earlier letter. Nobody (not even the owner) can read it before it opens.
export async function setCapsule(me: CurrentUser, goalId: string, text: unknown): Promise<Result> {
  const g = await ownGoal(me, goalId);
  if (!g) return { error: "Goal not found." };
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length > CAPSULE_MAX) return { error: `Keep the letter under ${CAPSULE_MAX.toLocaleString()} characters.` };
  await db.goal.update({ where: { id: g.id }, data: { capsule: t || null } });
  return { ok: true };
}

// ---------- sharing a goal with chosen connections ----------

// Replaces who a `limited` goal is shared with; only current connections are kept.
export async function setShares(ownerId: string, goalId: string, userIds: string[]) {
  const friends = new Set(await connectionIds(ownerId));
  const keep = [...new Set(userIds)].filter((id) => friends.has(id));
  await db.$transaction([
    db.goalShare.deleteMany({ where: { goalId } }),
    ...(keep.length ? [db.goalShare.createMany({ data: keep.map((userId) => ({ goalId, userId })) })] : []),
  ]);
}
