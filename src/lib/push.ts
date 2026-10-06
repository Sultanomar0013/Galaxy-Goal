import "server-only";
import webpush from "web-push";
import * as z from "zod";
import { db } from "@/lib/db";
import * as live from "@/lib/realtime";

// Web push: phone / desktop notifications for things that happen while the user has no Goal Galaxy
// tab open (with a tab open they already see a toast). Needs VAPID keys in .env.

const PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const enabled = !!(PUBLIC && PRIVATE);
if (enabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", PUBLIC, PRIVATE);

export const pushPublicKey = () => (enabled ? PUBLIC : null);

export const SubscriptionInput = z.object({
  endpoint: z.url().max(600),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function saveSubscription(userId: string, input: unknown) {
  const parsed = SubscriptionInput.safeParse(input);
  if (!parsed.success) return { error: "That browser subscription looks wrong." };
  const { endpoint, keys } = parsed.data;
  // an endpoint belongs to one browser; if someone else signs in on it, it moves to them
  await db.pushSub.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });
  return { ok: true as const };
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db.pushSub.deleteMany({ where: { userId, endpoint: String(endpoint) } });
  return { ok: true as const };
}

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

// Sends to every browser of the users who have no tab open right now. Never throws.
export async function notifyOffline(userIds: string[], msg: PushMessage) {
  if (!enabled) return;
  const ids = [...new Set(userIds)].filter((id) => !live.isOnline(id));
  if (!ids.length) return;
  try {
    const subs = await db.pushSub.findMany({ where: { userId: { in: ids } } });
    const payload = JSON.stringify({ ...msg, url: msg.url || "/" });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.pushSub.deleteMany({ where: { id: s.id } }); // browser unsubscribed
          else console.error("[push] send failed", code ?? e);
        }
      }),
    );
  } catch (e) {
    console.error("[push]", e);
  }
}
