// Goal Galaxy service worker: shows push notifications, and serves a small page when you're offline
// (having one also lets browsers offer to install the app).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Goal Galaxy", {
      body: d.body || "",
      tag: d.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: d.url || "/" },
    }),
  );
});

// Tapping a notification brings an open Goal Galaxy window forward, or opens one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});

const OFFLINE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goal Galaxy</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#04050d;color:#e8ecff;font-family:Georgia,serif;text-align:center">
<div><h1 style="font-weight:400">Goal Galaxy</h1><p style="font-family:sans-serif;color:#7b83a6">You're offline. Your galaxy will be back when you reconnect.</p></div></body></html>`;

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
