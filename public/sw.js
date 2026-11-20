const CACHE = "oau-campus-v7"; // the page shell and the app's own hashed files (/_next/static): replaced by a new name when this file's rules change
// 3D models, map data and textures live in their OWN cache, shared with the page (lib3d/assets/store.js uses the same name). Every file in it has a content hash in its URL (?v=...), so an entry can
// never go stale and the cache is NOT thrown away on a new deployment: files whose hash did not change are kept, files that are no longer in /asset-manifest.json are deleted (pruneAssets).
const ASSETS = "oau-assets-v1";
const ASSET_ROOTS = ["/models/", "/data/", "/textures/", "/maps/"]; // /audio/ is left to the browser: media elements ask for byte ranges, which Cache Storage cannot answer
const isAsset = (pathname) => ASSET_ROOTS.some((root) => pathname.startsWith(root));
const SHELL = ["/", "/home", "/offline.html"]; // /home is the installed app's start_url (see src/app/manifest.js); /play only redirects to it
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "PRUNE_ASSETS") event.waitUntil(pruneAssets());
});
// Deletes saved assets that the current deployment no longer lists (an old version of a changed file, a removed file). Best effort: with no network or no manifest nothing is deleted.
async function pruneAssets() {
  try {
    const response = await fetch("/asset-manifest.json", { cache: "no-store" });
    if (!response.ok) return 0;
    const { assets } = await response.json();
    if (!assets || typeof assets !== "object") return 0;
    const current = new Set(Object.entries(assets).map(([path, info]) => `${path}?v=${info.v}`));
    const cache = await caches.open(ASSETS);
    let removed = 0;
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (isAsset(url.pathname) && !current.has(url.pathname + url.search) && (await cache.delete(request))) removed++;
    }
    return removed;
  } catch { return 0; }
}
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key === "offline-v1" || key.startsWith("oau-campus-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => pruneAssets()).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => await caches.match(url.pathname) || await caches.match("/offline.html")));
    return;
  }
  // Managed assets (3D models, map data, textures). A URL with ?v=<hash of the file> (lib3d/assets/manifest.js) can never change, so the saved copy is served without asking the network
  // and a miss is downloaded once and saved. A URL WITHOUT a version could be out of date, so it is never served from here while the network works (only when the player is offline).
  // Requests for a byte range (media, resumed downloads) and anything that is not a plain successful file are left to the browser.
  if (isAsset(url.pathname)) {
    if (request.headers.has("range")) return;
    if (url.searchParams.has("v")) {
      event.respondWith(caches.open(ASSETS).then(async (cache) => {
        const saved = await cache.match(request);
        if (saved) return saved;
        const response = await fetch(request);
        if (response.status === 200 && response.type === "basic" && !/text\/html/i.test(response.headers.get("content-type") || "")) event.waitUntil(cache.put(request, response.clone()).catch(() => {})); // a full disk only means "not saved"
        return response;
      }));
    } else {
      event.respondWith(fetch(request).catch(async () => (await caches.match(request, { ignoreSearch: true })) || Response.error()));
    }
    return;
  }
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/app-icons/")) return;
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