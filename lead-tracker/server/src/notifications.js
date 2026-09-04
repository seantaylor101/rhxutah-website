import { randomUUID } from "node:crypto";
import { withTenant } from "./db/pool.js";

export async function createNotification(tenantId, { leadId, title, body }) {
  const id = randomUUID();
  await withTenant(tenantId, (client) =>
    client.query(
      `INSERT INTO notifications (id, tenant_id, lead_id, title, body) VALUES ($1, $2, $3, $4, $5)`,
      [id, tenantId, leadId || null, title, body]
    )
  );
  return { id, tenantId, leadId: leadId || null, title, body };
}
