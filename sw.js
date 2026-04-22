// ============================================================
// SW.JS — Service Worker (PWA offline shell caching)
// Firebase SDK handles Firestore data offline independently.
// ============================================================

const CACHE_NAME = "therapy-tracker-v3";

// App shell files to pre-cache
const SHELL_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/config.js",
  "/app.js",
  "/firebase-service.js",
  "/export.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// Install: cache app shell
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for local shell (always get latest); offline falls back to cache
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // External requests (Firebase, CDN) — always network, don't intercept
  if (url.origin !== self.location.origin) return;

  // Local — try network first, cache the response, fall back to cache if offline
  event.respondWith(
    fetch(event.request).then(resp => {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return resp;
    }).catch(() => caches.match(event.request))
  );
});
