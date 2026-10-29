// The cab's service worker: it makes the cab installable (a home-screen app, fullscreen) and lets
// it open without a network. Network first, so a fresh copy is used whenever there is one; the
// cache only answers when the network can't. It never reloads or changes a page that is open: new
// code arrives at the next start, never mid-drive. The depot's endpoints are never cached.

const CACHE = "robot-cab-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/depot/")) return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? Response.error())),
  );
});
