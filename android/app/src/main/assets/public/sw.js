/// <reference lib="webworker" />

// WishWash Service Worker — handles web push notifications and
// notification click navigation. The service worker is required for
// push notifications to work when the app is in the background or closed.

const CACHE_NAME = "wishwash-v1";

// ============================================================
// Install: pre-cache nothing (app shell is handled by Vite)
// ============================================================
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// ============================================================
// Activate: claim all clients immediately
// ============================================================
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ============================================================
// Push event: display a notification
// ============================================================
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // If the payload isn't JSON, try plain text
    data = { title: "WishWash", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "WishWash";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.notification_type ? `wishwash-${data.notification_type}` : "wishwash",
    data: {
      screen: data.screen || null,
      booking_id: data.booking_id || null,
      notification_type: data.notification_type || null,
    },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ============================================================
// Notification click: navigate to the appropriate screen
// ============================================================
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { screen, booking_id } = event.notification.data || {};

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // If a client is already open, focus it and send navigation message
      if (allClients.length > 0) {
        const client = allClients[0];
        await client.focus();
        if (screen) {
          client.postMessage({
            type: "NOTIFICATION_CLICK",
            screen,
            booking_id: booking_id || null,
          });
        }
        return;
      }

      // No open client — open the app with a hash for the target screen
      let url = "/";
      if (screen) {
        const params = new URLSearchParams();
        params.set("screen", screen);
        if (booking_id) params.set("booking_id", booking_id);
        url = `/?${params.toString()}`;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
