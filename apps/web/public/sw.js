/*
 * TransferGo — minimal service worker.
 *
 * Purpose: satisfy the "installable PWA" criteria (a fetch handler must exist)
 * so Chrome shows the "Instalar app" prompt. There is no real offline mode —
 * every transfer needs the network — but the home shell is cached so an
 * offline launch shows the app instead of the browser error page.
 */
const CACHE = "transfergo-shell-v1";
const SHELL = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("/");
        if (shell) return shell;
      }
      return Response.error();
    })
  );
});
