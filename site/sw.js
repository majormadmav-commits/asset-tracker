const CACHE = "asset-tracker-shell-v1";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./manifest.webmanifest",
  "./js/main.js",
  "./js/render.js",
  "./js/local-store.js",
  "./js/drive-store.js",
  "./js/schema.js",
  "./js/ids.js",
  "./js/photo.js",
  "./js/format.js",
  "./js/storage-keys.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./seed/seed-data.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html"))),
  );
});
