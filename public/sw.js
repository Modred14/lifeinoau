const CACHE = "oau-campus-v4";
const SHELL = ["/", "/home", "/offline.html"]; // /home is the installed app's start_url (see src/app/manifest.js); /play only redirects to it
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key === "offline-v1" || key.startsWith("oau-campus-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => await caches.match(url.pathname) || await caches.match("/offline.html")));
    return;
  }
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/campus/") && !url.pathname.startsWith("/app-icons/")) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - 220))) if (!SHELL.includes(new URL(key.url).pathname)) await cache.delete(key);
    }
    return response;
  }));
});
self.addEventListener("push", (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { return; }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "CHAT_PUSH", message: data });
    if (windows.some((client) => client.focused && client.visibilityState === "visible")) return;
    await self.registration.showNotification(data.title || "New message", {
      body: data.body || "You received a new message.",
      tag: data.tag || "lifeinoau-message",
      renotify: false,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url || "/home?app=messages" },
    });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/home?app=messages";
  event.waitUntil((async () => {
    const targetUrl = new URL(path, self.location.origin);
    if (targetUrl.origin !== self.location.origin) targetUrl.href = new URL("/home?app=messages", self.location.origin).href;
    const target = targetUrl.href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "navigate" in client) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
