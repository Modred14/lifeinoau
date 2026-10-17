const CACHE = "oau-campus-v3";
const SHELL = ["/", "/play", "/offline.html"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
