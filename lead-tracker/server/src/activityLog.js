import { randomUUID } from "node:crypto";
import { withTenant } from "./db/pool.js";

// Throttled to 1 row/min per (tenant, actor) via the NOT EXISTS guard, same intent as the
// old in-memory throttle -- this is the "PM/admin opened the app" signal shown to admins.
export async function logAccess(tenantId, actorUserId) {
  await withTenant(tenantId, (client) =>
    client.query(
      `INSERT INTO access_log (id, tenant_id, actor_user_id, created_at)
       SELECT $1, $2, $3, now()
       WHERE NOT EXISTS (
         SELECT 1 FROM access_log
         WHERE tenant_id = $2 AND actor_user_id = $3 AND created_at > now() - interval '1 minute'
       )`,
      [randomUUID(), tenantId, actorUserId]
    )
  );
}

export async function logMove({ tenantId, type, entityId, entityName, fromStage, toStage, actorUserId }) {
  await withTenant(tenantId, (client) =>
    client.query(
      `INSERT INTO activity_log (id, tenant_id, type, entity_id, entity_name, from_stage, to_stage, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), tenantId, type, entityId, entityName, fromStage || null, toStage, actorUserId || null]
    )
  );
}
