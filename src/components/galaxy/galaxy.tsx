"use client";

import { useEffect, useRef } from "react";
import * as goalActions from "@/app/actions/goals";
import { logout } from "@/app/actions/auth";
import * as social from "@/app/actions/connections";
import type { SocialState } from "@/app/actions/connections";
import * as mv from "@/app/actions/multiverse";
import type { MultiverseDTO } from "@/app/actions/multiverse";
import type { GoalDTO } from "@/lib/goals";
import "./galaxy.css";

type Props = {
  initialGoals: GoalDTO[];
  initialSocial: SocialState;
  initialMultiverses: MultiverseDTO[];
  user: { id: string; name: string };
};

const API = {
  listGoals: goalActions.listGoals,
  saveGoal: goalActions.saveGoal,
  deleteGoal: goalActions.deleteGoal,
  addStep: goalActions.addStep,
  updateStep: goalActions.updateStep,
  deleteStep: goalActions.deleteStep,
  suggestStep: goalActions.suggestStep,
  decideStep: goalActions.decideStep,
  linkGoals: goalActions.linkGoals,
  unlinkGoals: goalActions.unlinkGoals,
  addNote: goalActions.addNote,
  deleteNote: goalActions.deleteNote,
  markNotesRead: goalActions.markNotesRead,
  setCapsule: goalActions.setCapsule,
  logout,
  getSocial: social.getSocial,
  findUser: social.findUser,
  sendConnect: social.sendConnect,
  respondConnect: social.respondConnect,
  removeConnect: social.removeConnect,
  setMentor: social.setMentor,
  saveGroup: social.saveGroup,
  deleteGroup: social.deleteGroup,
  setFriendGroup: social.setFriendGroup,
  recordVisit: social.recordVisit,
  setPublic: social.setPublic,
  pushKey: social.pushKey,
  savePush: social.savePush,
  removePush: social.removePush,
  getMultiverses: mv.getMultiverses,
  createMultiverse: mv.createMultiverse,
  respondMvInvite: mv.respondMvInvite,
  inviteMvMembers: mv.inviteMvMembers,
  removeMvMember: mv.removeMvMember,
  leaveMultiverse: mv.leaveMultiverse,
  deleteMultiverse: mv.deleteMultiverse,
  submitMvChange: mv.submitMvChange,
  decideMvChange: mv.decideMvChange,
  withdrawMvChange: mv.withdrawMvChange,
};

// Loads the Three.js engine (big, browser-only) into a div it owns, and tears it down on unmount.
function useEngine(options: () => Record<string, unknown>) {
  const rootRef = useRef<HTMLDivElement>(null);
  // the engine keeps its own state after mounting, so only the first props matter
  const initial = useRef(options);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import("./engine.js").then(({ startGalaxy }) => {
      if (cancelled || !rootRef.current) return;
      dispose = startGalaxy(rootRef.current, initial.current() as unknown as Parameters<typeof startGalaxy>[1]);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  return rootRef;
}

// Thin React wrapper around the ported Three.js engine: it owns the DOM inside the root div.
export function Galaxy({ initialGoals, initialSocial, initialMultiverses, user }: Props) {
  const rootRef = useEngine(() => ({ initialGoals, initialSocial, initialMultiverses, user, api: API }));
  return <div ref={rootRef} className="gg-root" />;
}

// A read-only galaxy for a shared link (/g/<slug>): no account, no editing, nothing social.
const none = async () => ({ error: "This is a read-only view." });
const READ_ONLY_API = new Proxy({} as typeof API, {
  get: (_t, key) => (key === "listGoals" || key === "getMultiverses" ? async () => [] : key === "getSocial" ? async () => null : none),
});

export function PublicGalaxy({ name, goals }: { name: string; goals: GoalDTO[] }) {
  const rootRef = useEngine(() => ({
    initialGoals: goals,
    initialSocial: null,
    initialMultiverses: [],
    user: { id: "public", name },
    api: READ_ONLY_API,
    readOnly: true,
  }));
  return <div ref={rootRef} className="gg-root" />;
}
