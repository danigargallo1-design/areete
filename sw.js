const CACHE = "arete-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./history.html",
  "./settings.html",
  "./manifest.webmanifest",
  "./assets/logo.svg",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./styles/globals.css",
  "./styles/typography.css",
  "./styles/layout.css",
  "./styles/cards.css",
  "./styles/animations.css",
  "./styles/notifications.css",
  "./js/app.js",
  "./js/ui.js",
  "./js/ritual.js",
  "./js/storage.js",
  "./js/history.js",
  "./js/settings.js",
  "./js/quotes.js",
  "./js/utils.js",
  "./js/notifications.js",
  "./data/habits.json",
  "./data/notifications.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html")))
  );
});

// Al pulsar una notificación local, abrir la aplicación.
// Si ya hay una ventana abierta se enfoca; si no, se abre index.html.
// La lógica de "abrir el ritual si no está completado / la pantalla final si lo está"
// la resuelve app.js automáticamente al cargar index.html.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        try {
          if ("navigate" in client) await client.navigate(targetUrl);
        } catch { /* algunos navegadores no soportan navigate; se ignora */ }
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
