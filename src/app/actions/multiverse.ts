"use server";

import { requireUser } from "@/lib/dal";
import * as mv from "@/lib/multiverse";

export type { MultiverseDTO } from "@/lib/multiverse";

// Called from the galaxy engine; each re-checks the session, the rules live in lib/multiverse.ts.

export async function getMultiverses() {
  return mv.listMultiverses(await requireUser());
}

export async function createMultiverse(input: unknown) {
  return mv.createMultiverse(await requireUser(), input);
}

export async function respondMvInvite(multiverseId: string, accept: boolean) {
  return mv.respondInvite(await requireUser(), multiverseId, accept);
}

export async function inviteMvMembers(multiverseId: string, userIds: string[]) {
  return mv.inviteMembers(await requireUser(), multiverseId, userIds);
}

export async function removeMvMember(multiverseId: string, userId: string) {
  return mv.removeMember(await requireUser(), multiverseId, userId);
}

export async function leaveMultiverse(multiverseId: string) {
  return mv.leaveMultiverse(await requireUser(), multiverseId);
}

export async function deleteMultiverse(multiverseId: string) {
  return mv.deleteMultiverse(await requireUser(), multiverseId);
}

export async function submitMvChange(multiverseId: string, change: unknown) {
  return mv.submitChange(await requireUser(), multiverseId, change);
}

export async function decideMvChange(changeId: string, approve: boolean) {
  return mv.decideChange(await requireUser(), changeId, approve);
}

export async function withdrawMvChange(changeId: string) {
  return mv.withdrawChange(await requireUser(), changeId);
}
