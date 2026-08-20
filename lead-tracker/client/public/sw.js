// take over any already-open tab right away instead of waiting for its next
// load — without this, a tab opened before this SW version activated stays
// on the old one until it's closed and reopened, which would leave the
// share-target handler below silently missing on it
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Web Share Target: iOS has no in-app "pick a contact" API, so sharing a
// contact card from the Contacts app straight to this installed PWA is the
// only way to get one in. The manifest points that share at POST
// /share-target; stash the vCard in Cache Storage and redirect back into
// the app (a plain page load, not this fetch response, is what the client
// actually renders) so App.jsx can read it back out after mount.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get("contact");
          const text = file ? await file.text() : "";
          const cache = await caches.open("shared-contact");
          await cache.put("/shared-contact-data", new Response(text, { headers: { "Content-Type": "text/vcard" } }));
        } catch {
          // fall through to the redirect either way — App.jsx just won't find anything cached
        }
        return Response.redirect("/?sharedContact=1", 303);
      })()
    );
  }
});

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
