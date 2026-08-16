self.addEventListener("push", (event) => {
  let data = { title: "Lead Slayer", body: "You have a new notification." };
  try {
    data = event.data.json();
  } catch {
    // non-JSON payload, fall back to defaults above
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Lead Slayer", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { leadId: data.leadId || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const leadId = event.notification.data && event.notification.data.leadId;
  const targetUrl = leadId ? `/?lead=${encodeURIComponent(leadId)}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if (leadId && "postMessage" in client) {
            client.postMessage({ type: "OPEN_LEAD", leadId });
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
