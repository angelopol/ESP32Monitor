/* Service worker: recibe Web Push y muestra la notificacion. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "Monitor de Luz", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Monitor de Luz";
  const isOutage = data.data && data.data.state === "off";

  const options = {
    body: data.body || "",
    tag: data.tag || "power",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: data.data || {},
    requireInteraction: Boolean(isOutage),
    vibrate: isOutage ? [200, 100, 200, 100, 200] : [120],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow("/");
      }),
  );
});
