import { Router } from "express";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();

router.get("/", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { tenantId } = req.effective;
    await withTenant(tenantId, async (client) => {
      const { rows: notifications } = await client.query(
        `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`
      );
      const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM notifications WHERE read_at IS NULL`);
      res.json({
        notifications: notifications.map((n) => ({
          id: n.id,
          leadId: n.lead_id,
          title: n.title,
          body: n.body,
          createdAt: n.created_at,
          readAt: n.read_at,
        })),
        unread: rows[0].c,
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/read", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    await withTenant(req.effective.tenantId, (client) =>
      client.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [req.params.id])
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/read-all", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    await withTenant(req.effective.tenantId, (client) =>
      client.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`)
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
