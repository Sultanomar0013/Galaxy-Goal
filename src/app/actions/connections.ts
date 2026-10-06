"use server";

import { requireUser } from "@/lib/dal";
import * as connections from "@/lib/connections";
import * as push from "@/lib/push";

export type { FindResult, FriendDTO, FriendGroupDTO, PersonRef, SocialState } from "@/lib/connections";

// Called from the galaxy engine; each re-checks the session, the rules live in lib/connections.ts.

export async function getSocial() {
  return connections.getSocial(await requireUser());
}

export async function findUser(email: string) {
  return connections.findUser(await requireUser(), email);
}

export async function sendConnect(userId: string) {
  return connections.sendConnect(await requireUser(), userId);
}

export async function respondConnect(connectionId: string, accept: boolean) {
  return connections.respondConnect(await requireUser(), connectionId, accept);
}

export async function removeConnect(connectionId: string) {
  return connections.removeConnect(await requireUser(), connectionId);
}

export async function setMentor(friendId: string, on: boolean) {
  return connections.setMentor(await requireUser(), friendId, !!on);
}

export async function saveGroup(groupId: string | null, input: { name: string; color: string }) {
  return connections.saveGroup(await requireUser(), groupId, input);
}

export async function deleteGroup(groupId: string) {
  return connections.deleteGroup(await requireUser(), groupId);
}

export async function setFriendGroup(friendId: string, groupId: string | null) {
  return connections.setFriendGroup(await requireUser(), friendId, groupId);
}

export async function recordVisit(hostId: string) {
  return connections.recordVisit(await requireUser(), hostId);
}

export async function setPublic(on: boolean) {
  return connections.setPublic(await requireUser(), !!on);
}

export async function pushKey() {
  await requireUser();
  return push.pushPublicKey();
}

export async function savePush(subscription: unknown) {
  return push.saveSubscription((await requireUser()).id, subscription);
}

export async function removePush(endpoint: string) {
  return push.removeSubscription((await requireUser()).id, endpoint);
}
