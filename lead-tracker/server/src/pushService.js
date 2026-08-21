import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails("mailto:sean@rhxutah.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

export function saveSubscription(sub, role) {
  const existing = db.prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`).get(sub.endpoint);
  if (existing) {
    // the role may have changed since this device last subscribed (e.g. the
    // same browser signed in with a different passcode) — keep it current
    db.prepare(`UPDATE push_subscriptions SET role = ? WHERE endpoint = ?`).run(role || null, sub.endpoint);
    return;
  }
  db.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, createdAt, role) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), sub.endpoint, sub.keys.p256dh, sub.keys.auth, new Date().toISOString(), role || null);
}

export function removeSubscription(endpoint) {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

async function sendPush(subs, payload) {
  if (!configured) return;
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

// targets only devices that were signed in as the given role when they
// subscribed — devices that subscribed before role-tracking existed won't
// have a role on file and are excluded until they resubscribe
export async function sendPushToRole(role, payload) {
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE role = ?`).all(role);
  await sendPush(subs, payload);
}
