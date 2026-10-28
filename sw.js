// Service Worker for Maestro POS PWA
//
// The app shell (HTML/JS/CSS) is NETWORK-FIRST so a new deployment reaches
// every phone/tablet on the next reload instead of being pinned behind an old
// cache - restaurant devices are rarely hard-refreshed, and a cache-first shell
// is how stale UI survives fixes. The cache remains the offline fallback.
const CACHE_NAME = "maestro-pos-v38";
const APP_SHELL = new Set(["/", "/index.html", "/app.js", "/styles.css"]);
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});
function cachePut(request, response) {
  if (!response || response.status !== 200 || request.method !== "GET") return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // API calls: Network-first, JSON error when offline.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: "Нема интернет врска. Проверете ја мрежата." }),
          { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } }
        );
      })
    );
    return;
  }

  // App shell: Network-first, cache (then offline index.html) as fallback.
  if (APP_SHELL.has(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          cachePut(event.request, response);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            const shell = await caches.match("/index.html");
            if (shell) return shell;
          }
          return new Response("", { status: 504, statusText: "Offline" });
        })
    );
    return;
  }

  // Everything else (icons, manifest): cache-first with background refresh.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          cachePut(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
