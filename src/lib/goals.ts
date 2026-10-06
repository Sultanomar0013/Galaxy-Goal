import "server-only";
import sanitizeHtml from "sanitize-html";
import * as z from "zod";
import type { GoalStatus, Importance, Prisma, Timeframe } from "@prisma/client";
import { db } from "@/lib/db";

// The galaxy works with lower-case values and YYYY-MM-DD dates (as the original HTML app did);
// the database uses enums and a DATE column. These maps translate between the two.
export const IMPORTANCE = { high: "HIGH", medium: "MEDIUM", low: "LOW" } as const satisfies Record<string, Importance>;
const TIMEFRAME = { short: "SHORT", mid: "MID", long: "LONG" } as const satisfies Record<string, Timeframe>;
export const STATUS = { ongoing: "ONGOING", done: "DONE", notdone: "NOT_DONE" } as const satisfies Record<string, GoalStatus>;

const invert = <T extends Record<string, string>>(m: T) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as { [K in keyof T as T[K]]: K };

export const IMPORTANCE_OUT = invert(IMPORTANCE);
const TIMEFRAME_OUT = invert(TIMEFRAME);
export const STATUS_OUT = invert(STATUS);

export type GoalStepDTO = { id: string; title: string; done: boolean; pending: boolean; suggestedBy: { id: string; name: string } | null };
export type GoalNoteDTO = { id: string; author: { id: string; name: string }; text: string; at: string; unread: boolean };
// sealed: the letter exists but stays closed until the goal is done or its date arrives
export type CapsuleDTO = { state: "none" } | { state: "sealed" } | { state: "open"; text: string };

export type GoalDTO = {
  id: string;
  name: string;
  category: string;
  importance: keyof typeof IMPORTANCE;
  timeframe: keyof typeof TIMEFRAME;
  date: string;
  status: keyof typeof STATUS;
  notes: string;
  isPrivate: boolean;
  limited: boolean; // shared only with `sharedWith` (owner only; empty for others)
  sharedWith: string[];
  why: string;
  capsule: CapsuleDTO;
  steps: GoalStepDTO[];
  links: string[]; // ids of this owner's goals that this one feeds into
  guestNotes: GoalNoteDTO[];
};

export const NOTES_MAX = 100_000;
export const STEPS_MAX = 20;
const NOTES_SHOWN = 30;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));

export const GoalInput = z.object({
  // ids are made in the browser so new planets can appear before the save finishes
  id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).transform((s) => s || "General"),
  importance: z.enum(["high", "medium", "low"]),
  timeframe: z.enum(["short", "mid", "long"]),
  date: isoDate,
  status: z.enum(["ongoing", "done", "notdone"]),
  notes: z.string().max(NOTES_MAX),
  isPrivate: z.boolean().default(false),
  limited: z.boolean().default(false),
  sharedWith: z.array(z.string().min(1).max(40)).max(200).default([]),
  why: z.string().trim().max(500).default(""),
});

// Same subset the editor produces; anything else (scripts, styles, images, event handlers) is dropped.
export function cleanNotes(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "b", "i", "u", "s", "h3", "h4", "ul", "ol", "li", "a", "blockquote"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  }).trim();
}

// Everything a goal's planet shows. `viewerId` decides what's included: owners see their sharing
// list, capsule and unread marks; everyone else sees only other people's accepted steps.
export const goalInclude = {
  steps: { include: { suggestedBy: { select: { id: true, name: true } } }, orderBy: { position: "asc" } },
  linksFrom: { select: { toId: true } },
  guestNotes: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: NOTES_SHOWN },
  shares: { select: { userId: true } },
} satisfies Prisma.GoalInclude;
export type FullGoal = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

const todayISO = () => new Date().toISOString().slice(0, 10);

export function toDTO(g: FullGoal, viewerId: string | null): GoalDTO {
  const owner = viewerId === g.userId;
  const date = g.targetDate.toISOString().slice(0, 10);
  const opens = g.status === "DONE" || date <= todayISO();
  return {
    id: g.id,
    name: g.name,
    category: g.category,
    importance: IMPORTANCE_OUT[g.importance],
    timeframe: TIMEFRAME_OUT[g.timeframe],
    date,
    status: STATUS_OUT[g.status],
    notes: g.notes ?? "",
    isPrivate: g.isPrivate,
    limited: owner ? g.limited : false,
    sharedWith: owner ? g.shares.map((s) => s.userId) : [],
    why: g.why ?? "",
    capsule: !owner || !g.capsule ? { state: "none" } : opens ? { state: "open", text: g.capsule } : { state: "sealed" },
    // a pending suggestion is visible to the owner (to decide) and to whoever suggested it
    steps: g.steps
      .filter((s) => !s.pending || owner || (!!viewerId && s.suggestedById === viewerId))
      .map((s) => ({ id: s.id, title: s.title, done: !!s.doneAt, pending: s.pending, suggestedBy: s.suggestedBy })),
    links: g.linksFrom.map((l) => l.toId),
    guestNotes: viewerId
      ? g.guestNotes.map((n) => ({
          id: n.id,
          author: n.author,
          text: n.text,
          at: n.createdAt.toISOString(),
          unread: owner && !n.readAt,
        }))
      : [],
  };
}

export function toData(g: z.infer<typeof GoalInput>) {
  return {
    name: g.name,
    category: g.category,
    importance: IMPORTANCE[g.importance],
    timeframe: TIMEFRAME[g.timeframe],
    targetDate: new Date(`${g.date}T00:00:00Z`),
    status: STATUS[g.status],
    notes: cleanNotes(g.notes) || null,
    isPrivate: g.isPrivate,
    limited: !g.isPrivate && g.limited,
    why: g.why || null,
  };
}

export async function goalsForUser(userId: string) {
  const rows = await db.goal.findMany({ where: { userId }, include: goalInclude, orderBy: { createdAt: "asc" } });
  return rows.map((g) => toDTO(g, userId));
}

// Which of `ownerId`'s goals `viewerId` (a connection) may see: not private, and either shared with
// all connections or shared with them in particular.
export function visibleTo(viewerId: string): Prisma.GoalWhereInput {
  return { isPrivate: false, OR: [{ limited: false }, { shares: { some: { userId: viewerId } } }] };
}
