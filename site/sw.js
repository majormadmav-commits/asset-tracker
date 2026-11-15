// Installed-app worker. It does not store the page or any response.
// An older worker cached the shell and could show that copy again; activate
// deletes those caches. Same-origin files are always re-read from the network
// so the next load is the current page. Google, Drive, fonts, and other
// cross-origin calls are not intercepted.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A navigation request cannot be copied with a RequestInit. Fetch the URL
  // directly so the browser HTTP cache cannot satisfy it either.
  const fresh =
    request.mode === "navigate"
      ? fetch(request.url, { cache: "no-store", credentials: "same-origin", redirect: "follow" })
      : fetch(request, { cache: "no-store" });
  event.respondWith(fresh);
});
