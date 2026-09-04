import { Router } from "express";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();

const FEED_LIMIT = 40;

// A single, chronologically-merged activity feed for the dashboard: lead/warranty stage
// moves and job (re)assignments for everyone, plus (tenant-admin-only) every time a PM
// has opened the app.
router.get("/feed", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const movesQuery =
        effective.role === "tenant_admin"
          ? client.query(
              `SELECT al.*, u.name AS actor_name FROM activity_log al LEFT JOIN users u ON u.id = al.actor_user_id
               WHERE al.tenant_id = $1 ORDER BY al.created_at DESC LIMIT $2`,
              [effective.tenantId, FEED_LIMIT]
            )
          : client.query(
              `SELECT al.*, u.name AS actor_name FROM activity_log al LEFT JOIN users u ON u.id = al.actor_user_id
               WHERE al.tenant_id = $1 AND al.actor_user_id = $2 ORDER BY al.created_at DESC LIMIT $3`,
              [effective.tenantId, effective.userId, FEED_LIMIT]
            );
      const { rows: moves } = await movesQuery;
      let entries = moves.map((row) => ({
        id: row.id,
        kind: "move",
        type: row.type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        fromStage: row.from_stage,
        toStage: row.to_stage,
        actorName: row.actor_name,
        createdAt: row.created_at,
      }));

      if (effective.role === "tenant_admin") {
        const { rows: access } = await client.query(
          `SELECT al.*, u.name AS actor_name FROM access_log al JOIN users u ON u.id = al.actor_user_id
           WHERE al.tenant_id = $1 AND u.role = 'pm' ORDER BY al.created_at DESC LIMIT $2`,
          [effective.tenantId, FEED_LIMIT]
        );
        entries = entries.concat(
          access.map((row) => ({ id: row.id, kind: "access", actorName: row.actor_name, createdAt: row.created_at }))
        );
      }

      entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json(entries.slice(0, FEED_LIMIT));
    });
  } catch (err) {
    next(err);
  }
});

export default router;
