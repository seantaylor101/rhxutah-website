import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { withTenant } from "./db/pool.js";

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails("mailto:sean@rhxutah.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

export async function saveSubscription(tenantId, userId, sub) {
  await withTenant(tenantId, async (client) => {
    const existing = await client.query(`SELECT id FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
    if (existing.rows.length) {
      await client.query(`UPDATE push_subscriptions SET user_id = $2 WHERE endpoint = $1`, [sub.endpoint, userId]);
      return;
    }
    await client.query(
      `INSERT INTO push_subscriptions (id, tenant_id, user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tenantId, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  });
}

export async function removeSubscription(tenantId, endpoint) {
  await withTenant(tenantId, (client) => client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]));
}

async function sendPush(tenantId, subs, payload) {
  if (!configured || !subs.length) return;
  await Promise.all(
    subs.map(async (row) => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removeSubscription(tenantId, row.endpoint).catch(() => {});
        }
      }
    })
  );
}

export async function sendPushToUser(tenantId, userId, payload) {
  const { rows } = await withTenant(tenantId, (client) =>
    client.query(`SELECT * FROM push_subscriptions WHERE user_id = $1`, [userId])
  );
  await sendPush(tenantId, rows, payload);
}

export async function sendPushToTenantAdmins(tenantId, payload) {
  const { rows } = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
       WHERE ps.tenant_id = $1 AND u.role = 'tenant_admin'`,
      [tenantId]
    )
  );
  await sendPush(tenantId, rows, payload);
}

export async function sendPushToTenant(tenantId, payload) {
  const { rows } = await withTenant(tenantId, (client) =>
    client.query(`SELECT * FROM push_subscriptions WHERE tenant_id = $1`, [tenantId])
  );
  await sendPush(tenantId, rows, payload);
}
