// Cache only the public application shell. User diagrams never reach this worker.
const VERSION = "equalcanvas-v0.2.0-1";
const BASE = new URL("./", self.location.href);
const CACHE = VERSION + "-" + BASE.pathname;
const ASSETS = [
  "./",
  "./index.html",
  "./about.html",
  "./style.css",
  "./app.js",
  "./model.js",
  "./insights.js",
  "./example.drawio",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
];
const ALLOWED = new Set(ASSETS.map((path) => new URL(path, BASE).href));
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([...ALLOWED])),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (
          key.startsWith("equalcanvas-") &&
          key.endsWith("-" + BASE.pathname) &&
          key !== CACHE
        )
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !ALLOWED.has(event.request.url)) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then(
        async (cache) =>
          (await cache.match(event.request)) || fetch(event.request),
      ),
  );
});
