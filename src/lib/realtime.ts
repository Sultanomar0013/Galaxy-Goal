import "server-only";

// Live updates for the multiverse. Each open tab keeps one Server-Sent Events stream (app/api/live);
// this hub knows which users have a stream open and pushes events to them. It also tracks who is
// where right now ("rooms"), and where each of them is looking. A room is a multiverse (keyed by its id)
// or someone's solar system (keyed "s:<host user id>": the host at home plus connections visiting).
//
// State lives in this Node process (kept on globalThis so route handlers, server actions and dev
// hot-reloads all share it). Running several server instances would need a shared broker instead.

type Send = (event: string, data: unknown) => void;
export type LiveClient = { userId: string; send: Send };
type Here = { focus: number[] | null; at: number; name: string };
type Room = { members: string[]; membersAt: number; here: Map<string, Here> };
type Hub = { clients: Map<string, Set<LiveClient>>; rooms: Map<string, Room>; limits: Map<string, number>; sweeper?: ReturnType<typeof setInterval> };

const g = globalThis as unknown as { __ggLive?: Hub };
const hub: Hub = (g.__ggLive ??= { clients: new Map(), rooms: new Map(), limits: new Map() });

const PRESENCE_TTL = 45_000; // a tab inside a multiverse re-announces itself every 20s
const MEMBERS_TTL = 30_000;

// ---------- connections ----------

export function addClient(userId: string, send: Send): LiveClient {
  const client = { userId, send };
  let set = hub.clients.get(userId);
  if (!set) hub.clients.set(userId, (set = new Set()));
  set.add(client);
  return client;
}

export function removeClient(client: LiveClient) {
  const set = hub.clients.get(client.userId);
  if (!set) return;
  set.delete(client);
  if (!set.size) {
    hub.clients.delete(client.userId);
    leaveRooms(client.userId); // their last tab closed
  }
}

export function isOnline(userId: string) {
  return hub.clients.has(userId);
}

export function publish(userIds: Iterable<string>, event: string, data: unknown) {
  for (const id of new Set(userIds)) {
    for (const c of hub.clients.get(id) ?? []) c.send(event, data);
  }
}

// ---------- presence ----------

function room(mvId: string) {
  let r = hub.rooms.get(mvId);
  if (!r) hub.rooms.set(mvId, (r = { members: [], membersAt: 0, here: new Map() }));
  return r;
}

// Cached active member ids, or null when they need to be (re)loaded from the database.
export function cachedMembers(mvId: string) {
  const r = hub.rooms.get(mvId);
  return r && Date.now() - r.membersAt < MEMBERS_TTL ? r.members : null;
}

export function setMembers(mvId: string, members: string[]) {
  const r = room(mvId);
  r.members = members;
  r.membersAt = Date.now();
  // people who are no longer members can't stay inside
  let changed = false;
  for (const id of r.here.keys()) if (!members.includes(id)) changed = r.here.delete(id) || changed;
  if (changed) broadcast(mvId);
}

export function invalidateMembers(mvId: string) {
  const r = hub.rooms.get(mvId);
  if (r) r.membersAt = 0;
}

export const sysRoom = (hostId: string) => "s:" + hostId;

// the event carrying a room's presence: "presence" {mvId, users} or "syspresence" {hostId, users}
function presenceOf(key: string) {
  const r = hub.rooms.get(key);
  const users = r ? [...r.here].map(([id, h]) => ({ id, name: h.name, focus: h.focus })) : [];
  return key.startsWith("s:")
    ? { event: "syspresence", data: { hostId: key.slice(2), users } }
    : { event: "presence", data: { mvId: key, users } };
}

function broadcast(key: string) {
  const r = hub.rooms.get(key);
  if (!r) return;
  const p = presenceOf(key);
  publish(r.members, p.event, p.data);
}

export function enterRoom(mvId: string, userId: string, focus: number[] | null, name = "") {
  const r = room(mvId);
  const known = r.here.has(userId);
  r.here.set(userId, { focus, at: Date.now(), name });
  broadcast(mvId);
  return known;
}

export function leaveRooms(userId: string, exceptMvId?: string) {
  for (const [mvId, r] of hub.rooms) {
    if (mvId !== exceptMvId && r.here.delete(userId)) broadcast(mvId);
  }
}

// Presence in every room this user may see, sent when their stream opens.
export function presenceFor(userId: string) {
  const out = [];
  for (const [key, r] of hub.rooms) if (r.members.includes(userId) && r.here.size) out.push(presenceOf(key));
  return out;
}

export function whoIsIn(mvId: string) {
  return [...(hub.rooms.get(mvId)?.here.keys() ?? [])];
}

// ---------- rate limiting (nudges, cheers) ----------

// True if the action may go ahead; false if the same key was used less than `ms` ago.
export function allow(key: string, ms: number) {
  const now = Date.now(), last = hub.limits.get(key) ?? 0;
  if (now - last < ms) return false;
  hub.limits.set(key, now);
  return true;
}

// ---------- housekeeping ----------

if (!hub.sweeper) {
  hub.sweeper = setInterval(() => {
    const now = Date.now();
    for (const [mvId, r] of hub.rooms) {
      let changed = false;
      for (const [id, h] of r.here) if (now - h.at > PRESENCE_TTL) changed = r.here.delete(id) || changed;
      if (changed) broadcast(mvId);
      if (!r.here.size && now - r.membersAt > MEMBERS_TTL) hub.rooms.delete(mvId);
    }
    for (const [k, t] of hub.limits) if (now - t > 300_000) hub.limits.delete(k);
  }, 15_000);
  hub.sweeper.unref?.();
}
