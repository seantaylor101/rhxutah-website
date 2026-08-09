import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails("mailto:sean@rhxutah.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

export function saveSubscription(sub) {
  const existing = db.prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`).get(sub.endpoint);
  if (existing) return;
  db.prepare(`INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, createdAt) VALUES (?, ?, ?, ?, ?)`).run(
    randomUUID(),
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
    new Date().toISOString()
  );
}

export function removeSubscription(endpoint) {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

export async function sendPushToAll(payload) {
  if (!configured) return;
  const subs = db.prepare(`SELECT * FROM push_subscriptions`).all();
  await Promise.all(
    subs.map(async (row) => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(row.endpoint);
      }
    })
  );
}
