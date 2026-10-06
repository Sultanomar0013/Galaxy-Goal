import "server-only";
import * as z from "zod";
import type { ActivityKind, ChangeKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { IMPORTANCE, IMPORTANCE_OUT, NOTES_MAX, STATUS, STATUS_OUT, cleanNotes, isoDate } from "@/lib/goals";
import { sendMail } from "@/lib/mail";
import * as live from "@/lib/realtime";
import { notifyOffline } from "@/lib/push";
import { connectionIds } from "@/lib/connections";

// Multiverse rules. Each function acts on behalf of `me` (the signed-in user; see app/actions/multiverse.ts).
// A multiverse is one goal shared by up to MAX_MEMBERS connected people. Everyone can edit; edits by
// anyone but the creator wait as change requests until the creator approves them.

export const MAX_MEMBERS = 5;
const MAX_MILESTONES = 30;
// moon / milestone-band colours, handed out in join order
const PALETTE = ["#ffd27a", "#8f9bff", "#6dffb0", "#ff8ad8", "#5de0ff"];
// the big bang and the supernova start this long after the moment happens, so every open tab can
// receive the event and play it at the same instant
const SYNC_DELAY = 1500;
const ACTIVITY_SHOWN = 20;

export type Result<T = object> = ({ ok: true } & T) | { error: string };

// ---------- shapes sent to the browser ----------

export type MvGoal = {
  name: string;
  category: string;
  importance: "high" | "medium" | "low";
  date: string;
  status: "ongoing" | "done" | "notdone";
  notes: string;
};
export type MvMember = { userId: string; name: string; color: string; status: "invited" | "active"; isCreator: boolean };
export type MvMilestone = { id: string; title: string; doneAt: string | null; doneBy: { id: string; name: string } | null };
export type MvChange = {
  id: string;
  kind: ChangeKind;
  author: { id: string; name: string };
  milestoneId: string | null;
  milestoneTitle: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
export type MvActivity = { id: string; kind: ActivityKind; actor: { id: string; name: string } | null; text: string; at: string };
export type MultiverseDTO = {
  id: string;
  completedAt: string | null;
  isCreator: boolean;
  myStatus: "invited" | "active";
  creator: { id: string; name: string };
  goal: MvGoal;
  members: MvMember[];
  milestones: MvMilestone[];
  // the creator sees every pending change; other members see only their own
  pending: MvChange[];
  activity: MvActivity[]; // newest first
};

// ---------- validation ----------

const Title = z.string().trim().min(1).max(200);
const GoalFields = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).transform((s) => s || "General"),
  importance: z.enum(["high", "medium", "low"]),
  date: isoDate,
  status: z.enum(["ongoing", "done", "notdone"]),
  notes: z.string().max(NOTES_MAX),
});

export const CreateInput = z.object({
  goal: GoalFields.omit({ status: true, notes: true }).extend({ notes: z.string().max(NOTES_MAX).default("") }),
  milestones: z.array(Title).max(MAX_MILESTONES),
  inviteIds: z.array(z.string().min(1).max(40)).max(MAX_MEMBERS - 1),
});

export const ChangeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("GOAL_UPDATE"), payload: GoalFields }),
  z.object({ kind: z.literal("MILESTONE_ADD"), payload: z.object({ title: Title }) }),
  z.object({ kind: z.literal("MILESTONE_EDIT"), milestoneId: z.string().min(1), payload: z.object({ title: Title }) }),
  z.object({ kind: z.literal("MILESTONE_DELETE"), milestoneId: z.string().min(1), payload: z.object({}) }),
  z.object({ kind: z.literal("MILESTONE_DONE"), milestoneId: z.string().min(1), payload: z.object({}) }),
  z.object({ kind: z.literal("MILESTONE_UNDONE"), milestoneId: z.string().min(1), payload: z.object({}) }),
]);
type Change = z.infer<typeof ChangeInput>;

// ---------- reading ----------

const fullInclude = {
  creator: { select: { id: true, name: true } },
  members: { include: { user: { select: { id: true, name: true } } }, orderBy: { invitedAt: "asc" } },
  milestones: { include: { doneBy: { select: { id: true, name: true } } }, orderBy: { position: "asc" } },
  changes: { where: { status: "PENDING" }, include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
  activity: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: ACTIVITY_SHOWN },
} satisfies Prisma.MultiverseInclude;
type FullMultiverse = Prisma.MultiverseGetPayload<{ include: typeof fullInclude }>;

function toDTO(mv: FullMultiverse, me: CurrentUser): MultiverseDTO {
  const isCreator = mv.creatorId === me.id;
  const mine = mv.members.find((m) => m.userId === me.id);
  const titles = new Map(mv.milestones.map((m) => [m.id, m.title]));
  return {
    id: mv.id,
    completedAt: mv.completedAt ? mv.completedAt.toISOString() : null,
    isCreator,
    myStatus: mine?.status === "ACTIVE" ? "active" : "invited",
    creator: mv.creator,
    goal: {
      name: mv.name,
      category: mv.category,
      importance: IMPORTANCE_OUT[mv.importance],
      date: mv.targetDate.toISOString().slice(0, 10),
      status: STATUS_OUT[mv.status],
      notes: mv.notes ?? "",
    },
    members: mv.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      color: m.color,
      status: m.status === "ACTIVE" ? "active" : "invited",
      isCreator: m.userId === mv.creatorId,
    })),
    milestones: mv.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      doneAt: m.doneAt ? m.doneAt.toISOString() : null,
      doneBy: m.doneBy,
    })),
    pending: mv.changes
      .filter((c) => isCreator || c.authorId === me.id)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        author: c.author,
        milestoneId: c.milestoneId,
        milestoneTitle: c.milestoneId ? (titles.get(c.milestoneId) ?? null) : null,
        payload: (c.payload ?? {}) as Record<string, unknown>,
        createdAt: c.createdAt.toISOString(),
      })),
    activity: mv.activity.map((a) => ({ id: a.id, kind: a.kind, actor: a.actor, text: a.text, at: a.createdAt.toISOString() })),
  };
}

export async function listMultiverses(me: CurrentUser): Promise<MultiverseDTO[]> {
  const rows = await db.multiverse.findMany({
    where: { members: { some: { userId: me.id } } },
    include: fullInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((mv) => toDTO(mv, me));
}

// ---------- helpers ----------

async function areConnected(a: string, b: string) {
  const c = await db.connection.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return !!c;
}

async function activeMembership(me: CurrentUser, multiverseId: string) {
  return db.multiverseMember.findFirst({
    where: { multiverseId: String(multiverseId), userId: me.id, status: "ACTIVE" },
    include: { multiverse: { select: { creatorId: true, name: true } } },
  });
}

async function memberIds(multiverseId: string, activeOnly = false) {
  const rows = await db.multiverseMember.findMany({
    where: { multiverseId, ...(activeOnly ? { status: "ACTIVE" as const } : {}) },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

// Tells every member's open tabs (plus `extra` people, e.g. someone just removed) to reload this multiverse.
async function notify(multiverseId: string, extra: string[] = []) {
  live.invalidateMembers(multiverseId);
  live.publish([...(await memberIds(multiverseId)), ...extra], "mv", { id: multiverseId });
}

function logActivity(client: Prisma.TransactionClient, multiverseId: string, actorId: string | null, kind: ActivityKind, text: string) {
  return client.mvActivity.create({ data: { multiverseId, actorId, kind, text: text.slice(0, 200) } });
}

// A multiverse is complete when the goal is marked done, or every milestone is. The first time it
// becomes complete, everyone online watches the supernova together.
async function syncCompletion(multiverseId: string, actorId: string) {
  const mv = await db.multiverse.findUnique({
    where: { id: multiverseId },
    select: { name: true, status: true, completedAt: true, milestones: { select: { doneAt: true } } },
  });
  if (!mv) return;
  const complete = mv.status === "DONE" || (mv.milestones.length > 0 && mv.milestones.every((m) => m.doneAt));
  if (complete && !mv.completedAt) {
    await db.$transaction([
      db.multiverse.update({ where: { id: multiverseId }, data: { completedAt: new Date() } }),
      logActivity(db, multiverseId, actorId, "COMPLETED", mv.name),
    ]);
    const ids = await memberIds(multiverseId, true);
    live.publish(ids, "nova", { mvId: multiverseId, at: Date.now() + SYNC_DELAY });
    await notifyOffline(ids, { title: "🌟 Goal completed together", body: `"${mv.name}" is done. It's a star in your sky now.`, tag: "nova-" + multiverseId });
  } else if (!complete && mv.completedAt) {
    await db.multiverse.update({ where: { id: multiverseId }, data: { completedAt: null } });
  }
}

function freeColor(used: string[]) {
  return PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];
}

async function emailInvite(inviter: CurrentUser, userIds: string[], goalName: string) {
  if (!userIds.length) return;
  await notifyOffline(userIds, { title: "Multiverse invitation", body: `${inviter.name} wants to work on "${goalName}" together.`, tag: "mv-invite" });
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { name: true, email: true } });
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  for (const u of users) {
    try {
      await sendMail(
        u.email,
        `${inviter.name} invited you to a multiverse on Goal Galaxy`,
        `Hi ${u.name},\n\n${inviter.name} wants to work on "${goalName}" together with you in a shared multiverse.\n\nOpen Goal Galaxy to accept or decline: ${appUrl}\n`,
        `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;color:#1a1d33">
          <h2 style="font-family:Georgia,serif;font-weight:normal">Goal Galaxy</h2>
          <p>Hi ${esc(u.name)},</p>
          <p><b>${esc(inviter.name)}</b> wants to work on <b>${esc(goalName)}</b> together with you in a shared multiverse.</p>
          <p><a href="${esc(appUrl)}" style="display:inline-block;background:#8f9bff;color:#0b0d1a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Goal Galaxy</a></p>
          <p style="color:#666;font-size:13px">Look for the 🌀 Multiverse button to accept or decline.</p>
        </div>`,
      );
    } catch (e) {
      console.error("[mail] failed to send multiverse invite", e);
    }
  }
}

// Applies one change inside a transaction. Returns false when its milestone no longer exists.
async function applyChange(tx: Prisma.TransactionClient, multiverseId: string, change: Change, authorId: string) {
  switch (change.kind) {
    case "GOAL_UPDATE": {
      const g = change.payload;
      await tx.multiverse.update({
        where: { id: multiverseId },
        data: {
          name: g.name,
          category: g.category,
          importance: IMPORTANCE[g.importance],
          targetDate: new Date(`${g.date}T00:00:00Z`),
          status: STATUS[g.status],
          notes: cleanNotes(g.notes) || null,
        },
      });
      return true;
    }
    case "MILESTONE_ADD": {
      const count = await tx.milestone.count({ where: { multiverseId } });
      if (count >= MAX_MILESTONES) return false;
      const last = await tx.milestone.aggregate({ where: { multiverseId }, _max: { position: true } });
      await tx.milestone.create({
        data: { multiverseId, title: change.payload.title, position: (last._max.position ?? -1) + 1 },
      });
      await logActivity(tx, multiverseId, authorId, "MILESTONE_ADDED", change.payload.title);
      return true;
    }
    case "MILESTONE_EDIT":
      return (await tx.milestone.updateMany({ where: { id: change.milestoneId, multiverseId }, data: { title: change.payload.title } })).count > 0;
    case "MILESTONE_DELETE":
      return (await tx.milestone.deleteMany({ where: { id: change.milestoneId, multiverseId } })).count > 0;
    case "MILESTONE_DONE": {
      const ms = await tx.milestone.findFirst({ where: { id: change.milestoneId, multiverseId }, select: { title: true, doneAt: true } });
      if (!ms) return false;
      await tx.milestone.update({ where: { id: change.milestoneId }, data: { doneAt: new Date(), doneById: authorId } });
      if (!ms.doneAt) await logActivity(tx, multiverseId, authorId, "MILESTONE_DONE", ms.title);
      return true;
    }
    case "MILESTONE_UNDONE":
      return (
        await tx.milestone.updateMany({ where: { id: change.milestoneId, multiverseId }, data: { doneAt: null, doneById: null } })
      ).count > 0;
  }
}

// ---------- actions ----------

export async function createMultiverse(me: CurrentUser, input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.path[0] === "inviteIds" && i.code === "too_big");
    return { error: tooMany ? `A multiverse holds at most ${MAX_MEMBERS} people, you included.` : "Please check the goal details." };
  }
  const { goal, milestones } = parsed.data;
  const inviteIds = [...new Set(parsed.data.inviteIds)].filter((id) => id !== me.id);

  for (const id of inviteIds) {
    if (!(await areConnected(me.id, id))) return { error: "You can only invite people you're connected with." };
  }

  const mv = await db.multiverse.create({
    data: {
      creatorId: me.id,
      name: goal.name,
      category: goal.category,
      importance: IMPORTANCE[goal.importance],
      targetDate: new Date(`${goal.date}T00:00:00Z`),
      notes: cleanNotes(goal.notes) || null,
      members: {
        create: [
          { userId: me.id, status: "ACTIVE", color: PALETTE[0], joinedAt: new Date() },
          ...inviteIds.map((userId, i) => ({ userId, color: PALETTE[i + 1] })),
        ],
      },
      milestones: { create: milestones.map((title, position) => ({ title, position })) },
      activity: { create: { actorId: me.id, kind: "CREATED", text: goal.name.slice(0, 200) } },
    },
    select: { id: true },
  });
  await notify(mv.id);
  await emailInvite(me, inviteIds, goal.name);
  return { ok: true, id: mv.id };
}

// Joining can complete the group; then every member online gets the big bang at the same moment (bornAt).
export async function respondInvite(me: CurrentUser, multiverseId: string, accept: boolean): Promise<Result<{ bornAt?: number }>> {
  const id = String(multiverseId);
  const where = { multiverseId: id, userId: me.id, status: "INVITED" as const };
  const res = accept
    ? await db.multiverseMember.updateMany({ where, data: { status: "ACTIVE", joinedAt: new Date() } })
    : await db.multiverseMember.deleteMany({ where });
  if (!res.count) return { error: "That invitation is no longer open." };
  if (!accept) {
    await notify(id, [me.id]);
    return { ok: true };
  }

  const mv = await db.multiverse.findUnique({ where: { id }, select: { name: true, members: { select: { userId: true, status: true } } } });
  if (!mv) return { ok: true };
  await logActivity(db, id, me.id, "JOINED", mv.name);
  await notify(id);
  if (mv.members.length > 1 && mv.members.every((m) => m.status === "ACTIVE")) {
    const bornAt = Date.now() + SYNC_DELAY;
    live.publish(mv.members.map((m) => m.userId), "born", { mvId: id, at: bornAt });
    await notifyOffline(mv.members.map((m) => m.userId), { title: "🌌 A multiverse is born", body: `Everyone joined "${mv.name}".`, tag: "born-" + id });
    return { ok: true, bornAt };
  }
  return { ok: true };
}

export async function inviteMembers(me: CurrentUser, multiverseId: string, userIds: string[]): Promise<Result> {
  const mv = await db.multiverse.findFirst({
    where: { id: String(multiverseId), creatorId: me.id },
    include: { members: { select: { userId: true, color: true } }, },
  });
  if (!mv) return { error: "Only the creator can invite people." };

  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].filter(
    (id) => !mv.members.some((m) => m.userId === id),
  );
  if (!ids.length) return { ok: true };
  if (mv.members.length + ids.length > MAX_MEMBERS) return { error: `A multiverse holds at most ${MAX_MEMBERS} people.` };
  for (const id of ids) {
    if (!(await areConnected(me.id, id))) return { error: "You can only invite people you're connected with." };
  }

  const used = mv.members.map((m) => m.color);
  const data = ids.map((userId) => {
    const color = freeColor(used);
    used.push(color);
    return { multiverseId: mv.id, userId, color };
  });
  await db.multiverseMember.createMany({ data, skipDuplicates: true });
  await notify(mv.id);
  await emailInvite(me, ids, mv.name);
  return { ok: true };
}

// Creator removes someone (member or pending invite). Their completed milestones keep their credit.
export async function removeMember(me: CurrentUser, multiverseId: string, userId: string): Promise<Result> {
  const mv = await db.multiverse.findFirst({ where: { id: String(multiverseId), creatorId: me.id }, select: { id: true } });
  if (!mv) return { error: "Only the creator can remove people." };
  if (userId === me.id) return { error: "The creator can't be removed. Delete the multiverse instead." };
  const wasActive = await db.multiverseMember.count({ where: { multiverseId: mv.id, userId: String(userId), status: "ACTIVE" } });
  await db.$transaction([
    db.multiverseMember.deleteMany({ where: { multiverseId: mv.id, userId: String(userId) } }),
    db.changeRequest.deleteMany({ where: { multiverseId: mv.id, authorId: String(userId), status: "PENDING" } }),
  ]);
  if (wasActive) await logActivity(db, mv.id, String(userId), "LEFT", "removed");
  await notify(mv.id, [String(userId)]);
  return { ok: true };
}

export async function leaveMultiverse(me: CurrentUser, multiverseId: string): Promise<Result> {
  const mv = await db.multiverse.findUnique({ where: { id: String(multiverseId) }, select: { id: true, creatorId: true } });
  if (!mv) return { error: "That multiverse no longer exists." };
  if (mv.creatorId === me.id) return { error: "As the creator you can delete the multiverse instead." };
  await db.$transaction([
    db.multiverseMember.deleteMany({ where: { multiverseId: mv.id, userId: me.id } }),
    db.changeRequest.deleteMany({ where: { multiverseId: mv.id, authorId: me.id, status: "PENDING" } }),
    logActivity(db, mv.id, me.id, "LEFT", "left"),
  ]);
  live.leaveRooms(me.id);
  await notify(mv.id, [me.id]);
  return { ok: true };
}

export async function deleteMultiverse(me: CurrentUser, multiverseId: string): Promise<Result> {
  const id = String(multiverseId);
  const ids = await memberIds(id);
  const res = await db.multiverse.deleteMany({ where: { id, creatorId: me.id } });
  if (!res.count) return { error: "Only the creator can delete this multiverse." };
  live.setMembers(id, []);
  live.publish(ids, "mv", { id });
  return { ok: true };
}

// The creator's changes apply straight away; everyone else's wait for the creator's approval.
export async function submitChange(me: CurrentUser, multiverseId: string, input: unknown): Promise<Result<{ applied: boolean }>> {
  const member = await activeMembership(me, multiverseId);
  if (!member) return { error: "You're not a member of this multiverse." };
  const parsed = ChangeInput.safeParse(input);
  if (!parsed.success) return { error: "That change has invalid values." };
  const change = parsed.data;
  const mvId = member.multiverseId;

  if (member.multiverse.creatorId === me.id) {
    const ok = await db.$transaction((tx) => applyChange(tx, mvId, change, me.id));
    if (!ok) return { error: "That milestone no longer exists, or the list is full." };
    await syncCompletion(mvId, me.id);
    await notify(mvId);
    return { ok: true, applied: true };
  }

  if ("milestoneId" in change) {
    const exists = await db.milestone.count({ where: { id: change.milestoneId, multiverseId: mvId } });
    if (!exists) return { error: "That milestone no longer exists." };
  }
  await db.changeRequest.create({
    data: {
      multiverseId: mvId,
      authorId: me.id,
      kind: change.kind,
      milestoneId: "milestoneId" in change ? change.milestoneId : null,
      payload: change.payload,
    },
  });
  await notify(mvId);
  return { ok: true, applied: false };
}

export async function decideChange(me: CurrentUser, changeId: string, approve: boolean): Promise<Result<{ applied: boolean }>> {
  const req = await db.changeRequest.findFirst({
    where: { id: String(changeId), status: "PENDING", multiverse: { creatorId: me.id } },
  });
  if (!req) return { error: "That change is no longer waiting." };

  if (!approve) {
    await db.changeRequest.update({ where: { id: req.id }, data: { status: "REJECTED", decidedAt: new Date() } });
    await notify(req.multiverseId);
    return { ok: true, applied: false };
  }

  // the author may have left since proposing it
  const stillMember = await db.multiverseMember.count({ where: { multiverseId: req.multiverseId, userId: req.authorId, status: "ACTIVE" } });
  const parsed = ChangeInput.safeParse({ kind: req.kind, milestoneId: req.milestoneId ?? undefined, payload: req.payload });
  if (!stillMember || !parsed.success) {
    await db.changeRequest.update({ where: { id: req.id }, data: { status: "REJECTED", decidedAt: new Date() } });
    await notify(req.multiverseId);
    return { error: "That change can't be applied any more, so it was dropped." };
  }

  const applied = await db.$transaction(async (tx) => {
    const ok = await applyChange(tx, req.multiverseId, parsed.data, req.authorId);
    await tx.changeRequest.update({ where: { id: req.id }, data: { status: ok ? "APPROVED" : "REJECTED", decidedAt: new Date() } });
    return ok;
  });
  if (applied) await syncCompletion(req.multiverseId, req.authorId);
  await notify(req.multiverseId);
  return applied ? { ok: true, applied: true } : { error: "That milestone no longer exists, so the change was dropped." };
}

// The author takes back a change that hasn't been decided yet.
export async function withdrawChange(me: CurrentUser, changeId: string): Promise<Result> {
  const req = await db.changeRequest.findFirst({ where: { id: String(changeId), authorId: me.id, status: "PENDING" }, select: { id: true, multiverseId: true } });
  const res = req ? await db.changeRequest.deleteMany({ where: { id: req.id, status: "PENDING" } }) : { count: 0 };
  if (!req || !res.count) return { error: "That change was already decided." };
  await notify(req.multiverseId);
  return { ok: true };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- live: presence, nudges, cheers (messages from the browser; see app/api/live) ----------

export const LiveInput = z.discriminatedUnion("type", [
  // mvId null = not inside any multiverse; focus = unit vector from the planet toward the viewer's camera
  z.object({
    type: z.literal("presence"),
    mvId: z.string().min(1).max(40).nullable(),
    focus: z.array(z.number().min(-1).max(1)).length(3).nullable().optional(),
  }),
  // in someone's solar system: your own at home (hostId = you) or a connection's you're visiting
  z.object({
    type: z.literal("syspresence"),
    hostId: z.string().min(1).max(40),
    focus: z.array(z.number().min(-1).max(1)).length(3).nullable().optional(),
  }),
  z.object({ type: z.literal("nudge"), mvId: z.string().min(1).max(40), to: z.string().min(1).max(40) }),
  z.object({ type: z.literal("cheer"), mvId: z.string().min(1).max(40), milestoneId: z.string().min(1).max(40) }),
]);

async function liveMembers(mvId: string) {
  let ids = live.cachedMembers(mvId);
  if (!ids) {
    ids = await memberIds(mvId, true);
    live.setMembers(mvId, ids);
  }
  return ids;
}

export async function handleLive(me: CurrentUser, input: unknown): Promise<Result<{ online?: boolean }>> {
  const parsed = LiveInput.safeParse(input);
  if (!parsed.success) return { error: "Bad message." };
  const msg = parsed.data;

  if (msg.type === "presence") {
    if (!msg.mvId) {
      live.leaveRooms(me.id);
      return { ok: true };
    }
    if (!(await liveMembers(msg.mvId)).includes(me.id)) return { error: "You're not a member of this multiverse." };
    live.leaveRooms(me.id, msg.mvId);
    live.enterRoom(msg.mvId, me.id, msg.focus ?? null, me.name);
    return { ok: true };
  }

  if (msg.type === "syspresence") {
    // the host and their connections share the room
    const key = live.sysRoom(msg.hostId);
    let ids = live.cachedMembers(key);
    if (!ids) {
      ids = [msg.hostId, ...(await connectionIds(msg.hostId))];
      live.setMembers(key, ids);
    }
    if (!ids.includes(me.id)) return { error: "You can only visit your connections." };
    live.leaveRooms(me.id, key);
    live.enterRoom(key, me.id, msg.focus ?? null, me.name);
    return { ok: true };
  }

  const members = await liveMembers(msg.mvId);
  if (!members.includes(me.id)) return { error: "You're not a member of this multiverse." };
  const from = { id: me.id, name: me.name };

  if (msg.type === "nudge") {
    if (msg.to === me.id || !members.includes(msg.to)) return { error: "They're not in this multiverse." };
    if (!live.allow(`nudge:${msg.mvId}:${me.id}:${msg.to}`, 20_000)) return { error: "You just nudged them. Give them a moment." };
    // everyone inside sees the pulse travel; the person nudged also gets told
    live.publish(members, "nudge", { mvId: msg.mvId, from, to: msg.to });
    const online = live.isOnline(msg.to);
    if (!online) await notifyOffline([msg.to], { title: `${me.name} nudged you 👋`, body: "Open your multiverse to see what's next.", tag: "nudge-" + msg.mvId });
    return { ok: true, online };
  }

  // cheer: sparks on a finished milestone's band, seen by everyone inside
  if (!live.allow(`cheer:${me.id}`, 700)) return { ok: true };
  const ms = await db.milestone.findFirst({
    where: { id: msg.milestoneId, multiverseId: msg.mvId, doneAt: { not: null } },
    select: { id: true, title: true, doneById: true },
  });
  if (!ms) return { error: "You can cheer a milestone once it's done." };
  live.publish(members, "cheer", { mvId: msg.mvId, milestoneId: ms.id, title: ms.title, doneBy: ms.doneById, from });
  return { ok: true };
}

// Presence in the user's multiverses, for a stream that has just opened.
export function presenceSnapshot(me: CurrentUser) {
  return live.presenceFor(me.id);
}
