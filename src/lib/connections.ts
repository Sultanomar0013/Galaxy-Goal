import "server-only";

import { randomBytes } from "node:crypto";
import * as z from "zod";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { goalInclude, toDTO, visibleTo, type GoalDTO } from "@/lib/goals";
import { sendMail } from "@/lib/mail";
import { notifyOffline } from "@/lib/push";
import * as live from "@/lib/realtime";

// Connection rules. Each function acts on behalf of `me` (the signed-in user; see app/actions/connections.ts).
// Connections between users. A pending request is visible to both sides; once accepted, each side
// sees the other's shared goals as a solar system, reached through a rift in their galaxy.

export type PersonRef = { id: string; name: string };
export type FriendGroupDTO = { id: string; name: string; color: string };
export type FriendDTO = {
  connectionId: string;
  user: PersonRef;
  goals: GoalDTO[];
  lastSeenAt: string | null; // their rift dims the longer they've been away
  visitedMeAt: string | null; // their last visit to my system, if within a day (footprints)
  iMentor: boolean; // they let me comment on and suggest steps for their goals
  mentorsMe: boolean; // I let them mentor me
  groupId: string | null; // my grouping of them
};
export type SocialState = {
  incoming: { connectionId: string; name: string; email: string }[];
  outgoing: { connectionId: string; name: string; email: string }[];
  friends: FriendDTO[];
  groups: FriendGroupDTO[];
  publicSlug: string | null;
};
export type FindResult =
  | { found: false }
  | { found: true; user: PersonRef; state: "self" | "none" | "outgoing" | "incoming" | "connected" };
type Result<T = object> = ({ ok: true } & T) | { error: string };

const MAX_PENDING_OUT = 50;
const MAX_GROUPS = 12;
const FOOTPRINT_MS = 24 * 3600 * 1000;
const Email = z.email().trim().toLowerCase();

const person = { select: { id: true, name: true, email: true } } as const;

export async function areConnected(a: string, b: string) {
  if (a === b) return false;
  const c = await db.connection.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] },
    select: { id: true },
  });
  return !!c;
}

export async function connectionIds(userId: string) {
  const rows = await db.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((c) => (c.requesterId === userId ? c.addresseeId : c.requesterId));
}

// Lets connections' open tabs know this person's goals changed.
export async function notifyFriends(userId: string) {
  live.publish(await connectionIds(userId), "social", { from: userId });
}

// "Last seen", written at most every couple of minutes.
export async function touchSeen(userId: string) {
  const since = new Date(Date.now() - 120_000);
  await db.user.updateMany({ where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: since } }] }, data: { lastSeenAt: new Date() } });
}

export async function getSocial(me: CurrentUser): Promise<SocialState> {
  await touchSeen(me.id);
  const [rows, groups, self] = await Promise.all([
    db.connection.findMany({
      where: { OR: [{ requesterId: me.id }, { addresseeId: me.id }] },
      include: { requester: person, addressee: person },
      orderBy: { createdAt: "asc" }, // stable order = each friend keeps their spot in the galaxy
    }),
    db.friendGroup.findMany({ where: { ownerId: me.id }, include: { members: { select: { userId: true } } }, orderBy: { createdAt: "asc" } }),
    db.user.findUnique({ where: { id: me.id }, select: { publicSlug: true } }),
  ]);

  const state: SocialState = { incoming: [], outgoing: [], friends: [], groups: groups.map(({ id, name, color }) => ({ id, name, color })), publicSlug: self?.publicSlug ?? null };
  const friendIds: string[] = [];
  for (const c of rows) {
    const mine = c.requesterId === me.id;
    const other = mine ? c.addressee : c.requester;
    if (c.status === "ACCEPTED") {
      state.friends.push({
        connectionId: c.id,
        user: { id: other.id, name: other.name },
        goals: [],
        lastSeenAt: null,
        visitedMeAt: null,
        iMentor: false,
        mentorsMe: false,
        groupId: groups.find((g) => g.members.some((m) => m.userId === other.id))?.id ?? null,
      });
      friendIds.push(other.id);
    } else (mine ? state.outgoing : state.incoming).push({ connectionId: c.id, name: other.name, email: other.email });
  }
  if (!friendIds.length) return state;

  const [goals, seen, visits, mentorships] = await Promise.all([
    db.goal.findMany({
      where: { userId: { in: friendIds }, user: { isActive: true }, ...visibleTo(me.id) },
      include: goalInclude,
      orderBy: { createdAt: "asc" },
    }),
    db.user.findMany({ where: { id: { in: friendIds } }, select: { id: true, lastSeenAt: true } }),
    db.visit.findMany({ where: { hostId: me.id, visitorId: { in: friendIds }, at: { gt: new Date(Date.now() - FOOTPRINT_MS) } } }),
    db.mentorship.findMany({ where: { OR: [{ ownerId: me.id, mentorId: { in: friendIds } }, { mentorId: me.id, ownerId: { in: friendIds } }] } }),
  ]);
  for (const f of state.friends) {
    const id = f.user.id;
    f.lastSeenAt = seen.find((u) => u.id === id)?.lastSeenAt?.toISOString() ?? null;
    f.visitedMeAt = visits.find((v) => v.visitorId === id)?.at.toISOString() ?? null;
    f.iMentor = mentorships.some((m) => m.ownerId === id && m.mentorId === me.id);
    f.mentorsMe = mentorships.some((m) => m.ownerId === me.id && m.mentorId === id);
  }
  for (const g of goals) state.friends.find((f) => f.user.id === g.userId)?.goals.push(toDTO(g, me.id));
  return state;
}

// Exact-email lookup only, so nobody can browse the user list.
export async function findUser(me: CurrentUser, email: string): Promise<FindResult> {
  const parsed = Email.safeParse(email);
  if (!parsed.success) return { found: false };

  const user = await db.user.findFirst({
    where: { email: parsed.data, isActive: true, emailVerifiedAt: { not: null } },
    select: { id: true, name: true },
  });
  if (!user) return { found: false };
  if (user.id === me.id) return { found: true, user, state: "self" };

  const c = await db.connection.findFirst({
    where: {
      OR: [
        { requesterId: me.id, addresseeId: user.id },
        { requesterId: user.id, addresseeId: me.id },
      ],
    },
  });
  const state = !c ? "none" : c.status === "ACCEPTED" ? "connected" : c.requesterId === me.id ? "outgoing" : "incoming";
  return { found: true, user, state };
}

export async function sendConnect(me: CurrentUser, userId: string): Promise<{ ok: true; state: "outgoing" | "connected" } | { error: string }> {
  const target = await db.user.findFirst({
    where: { id: String(userId), isActive: true, emailVerifiedAt: { not: null } },
    select: { id: true, name: true, email: true },
  });
  if (!target || target.id === me.id) return { error: "That person can't be found." };

  const existing = await db.connection.findFirst({
    where: {
      OR: [
        { requesterId: me.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: me.id },
      ],
    },
  });
  if (existing?.status === "ACCEPTED") return { ok: true, state: "connected" };
  if (existing?.requesterId === me.id) return { ok: true, state: "outgoing" };
  if (existing) {
    // they already asked us: sending back counts as accepting
    await db.connection.update({ where: { id: existing.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    live.publish([target.id], "social", { from: me.id });
    return { ok: true, state: "connected" };
  }

  const pending = await db.connection.count({ where: { requesterId: me.id, status: "PENDING" } });
  if (pending >= MAX_PENDING_OUT) return { error: "You have too many unanswered requests. Wait for some replies first." };

  await db.connection.create({ data: { requesterId: me.id, addresseeId: target.id } });
  live.publish([target.id], "social", { from: me.id });
  await notifyOffline([target.id], { title: "New connection request", body: `${me.name} wants to connect on Goal Galaxy.`, tag: "connect" });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    await sendMail(
      target.email,
      `${me.name} wants to connect on Goal Galaxy`,
      `Hi ${target.name},\n\n${me.name} (${me.email}) wants to connect on Goal Galaxy. If you accept, you'll each see the other's shared goals as a solar system in your galaxy.\n\nOpen Goal Galaxy to accept or decline: ${appUrl}\n`,
      `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;color:#1a1d33">
        <h2 style="font-family:Georgia,serif;font-weight:normal">Goal Galaxy</h2>
        <p>Hi ${esc(target.name)},</p>
        <p><b>${esc(me.name)}</b> (${esc(me.email)}) wants to connect. If you accept, you'll each see the other's shared goals as a solar system in your galaxy.</p>
        <p><a href="${esc(appUrl)}" style="display:inline-block;background:#8f9bff;color:#0b0d1a;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Goal Galaxy</a></p>
        <p style="color:#666;font-size:13px">Look for the 👥 Connections button to accept or decline.</p>
      </div>`,
    );
  } catch (e) {
    // the request still exists and shows up in their app; the email is only a heads-up
    console.error("[mail] failed to send connect request email", e);
  }
  return { ok: true, state: "outgoing" };
}

export async function respondConnect(me: CurrentUser, connectionId: string, accept: boolean): Promise<{ ok: boolean }> {
  const where = { id: String(connectionId), addresseeId: me.id, status: "PENDING" as const };
  const row = await db.connection.findFirst({ where, select: { requesterId: true } });
  const res = accept
    ? await db.connection.updateMany({ where, data: { status: "ACCEPTED", respondedAt: new Date() } })
    : await db.connection.deleteMany({ where });
  if (res.count && row) live.publish([row.requesterId], "social", { from: me.id });
  return { ok: res.count > 0 };
}

// Cancels a sent request or removes an existing connection (either side may do this). Everything
// that only made sense between the two of them goes too: mentoring, grouping, per-person sharing, footprints.
export async function removeConnect(me: CurrentUser, connectionId: string): Promise<{ ok: boolean }> {
  const c = await db.connection.findFirst({
    where: { id: String(connectionId), OR: [{ requesterId: me.id }, { addresseeId: me.id }] },
    select: { id: true, requesterId: true, addresseeId: true },
  });
  if (!c) return { ok: false };
  const other = c.requesterId === me.id ? c.addresseeId : c.requesterId;
  const pair = (a: string, b: string) => [a, b];
  await db.$transaction([
    db.connection.delete({ where: { id: c.id } }),
    db.mentorship.deleteMany({ where: { OR: [{ ownerId: me.id, mentorId: other }, { ownerId: other, mentorId: me.id }] } }),
    db.friendGroupMember.deleteMany({ where: { OR: [{ userId: other, group: { ownerId: me.id } }, { userId: me.id, group: { ownerId: other } }] } }),
    db.goalShare.deleteMany({ where: { OR: [{ userId: other, goal: { userId: me.id } }, { userId: me.id, goal: { userId: other } }] } }),
    db.visit.deleteMany({ where: { visitorId: { in: pair(me.id, other) }, hostId: { in: pair(me.id, other) } } }),
  ]);
  live.publish([other], "social", { from: me.id });
  return { ok: true };
}

// ---------- mentors ----------

// I let a connection mentor me (or stop): they can then suggest steps for my goals.
export async function setMentor(me: CurrentUser, friendId: string, on: boolean): Promise<Result> {
  const id = String(friendId);
  if (!(await areConnected(me.id, id))) return { error: "You can only choose a connection as a mentor." };
  if (on) await db.mentorship.upsert({ where: { ownerId_mentorId: { ownerId: me.id, mentorId: id } }, create: { ownerId: me.id, mentorId: id }, update: {} });
  else await db.mentorship.deleteMany({ where: { ownerId: me.id, mentorId: id } });
  live.publish([id], "social", { from: me.id });
  if (on) await notifyOffline([id], { title: "You're a mentor now", body: `${me.name} asked you to mentor their goals.`, tag: "mentor" });
  return { ok: true };
}

export async function isMentor(mentorId: string, ownerId: string) {
  return !!(await db.mentorship.findUnique({ where: { ownerId_mentorId: { ownerId, mentorId } }, select: { ownerId: true } }));
}

// ---------- groups (clusters of rifts) ----------

const GroupInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });

export async function saveGroup(me: CurrentUser, groupId: string | null, input: unknown): Promise<Result<{ id: string }>> {
  const parsed = GroupInput.safeParse(input);
  if (!parsed.success) return { error: "Give the group a name (up to 40 characters)." };
  if (groupId) {
    const res = await db.friendGroup.updateMany({ where: { id: String(groupId), ownerId: me.id }, data: parsed.data });
    return res.count ? { ok: true, id: String(groupId) } : { error: "That group no longer exists." };
  }
  if ((await db.friendGroup.count({ where: { ownerId: me.id } })) >= MAX_GROUPS) return { error: `You can have up to ${MAX_GROUPS} groups.` };
  const g = await db.friendGroup.create({ data: { ownerId: me.id, ...parsed.data }, select: { id: true } });
  return { ok: true, id: g.id };
}

export async function deleteGroup(me: CurrentUser, groupId: string): Promise<Result> {
  await db.friendGroup.deleteMany({ where: { id: String(groupId), ownerId: me.id } });
  return { ok: true };
}

// Puts a connection in one of my groups (or none); a person is in at most one of my groups.
export async function setFriendGroup(me: CurrentUser, friendId: string, groupId: string | null): Promise<Result> {
  const id = String(friendId);
  if (!(await areConnected(me.id, id))) return { error: "That person isn't one of your connections." };
  if (groupId && !(await db.friendGroup.count({ where: { id: String(groupId), ownerId: me.id } }))) return { error: "That group no longer exists." };
  await db.$transaction([
    db.friendGroupMember.deleteMany({ where: { userId: id, group: { ownerId: me.id } } }),
    ...(groupId ? [db.friendGroupMember.create({ data: { groupId: String(groupId), userId: id } })] : []),
  ]);
  return { ok: true };
}

// ---------- visits (footprints) ----------

export async function recordVisit(me: CurrentUser, hostId: string): Promise<Result> {
  const id = String(hostId);
  if (!(await areConnected(me.id, id))) return { error: "You can only visit your connections." };
  await db.visit.upsert({ where: { visitorId_hostId: { visitorId: me.id, hostId: id } }, create: { visitorId: me.id, hostId: id }, update: { at: new Date() } });
  if (live.allow(`visit:${me.id}:${id}`, 60_000)) live.publish([id], "visit", { from: { id: me.id, name: me.name }, at: Date.now() });
  return { ok: true };
}

// ---------- public galaxy ----------

// Turns the read-only link to my galaxy on (a fresh unguessable address each time) or off.
export async function setPublic(me: CurrentUser, on: boolean): Promise<Result<{ slug: string | null }>> {
  const slug = on ? randomBytes(9).toString("base64url") : null;
  await db.user.update({ where: { id: me.id }, data: { publicSlug: slug } });
  return { ok: true, slug };
}

// What anyone with the link sees: the owner's name and the goals shared with all connections.
export async function publicGalaxy(slug: string) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(slug)) return null;
  const user = await db.user.findFirst({ where: { publicSlug: slug, isActive: true }, select: { id: true, name: true } });
  if (!user) return null;
  const goals = await db.goal.findMany({ where: { userId: user.id, isPrivate: false, limited: false }, include: goalInclude, orderBy: { createdAt: "asc" } });
  return { name: user.name, goals: goals.map((g) => toDTO(g, null)) };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
