self.addEventListener("push", (event) => {
  let data = { title: "RHX Job Board", body: "You have a new notification." };
  try {
    data = event.data.json();
  } catch {
    // non-JSON payload, fall back to defaults above
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "RHX Job Board", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
