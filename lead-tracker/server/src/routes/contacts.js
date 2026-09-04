import { Router } from "express";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();

// Tenant-admin-only end to end -- this list exists so the admin isn't retyping a repeat
// customer's info, and (per the proprietary-data boundary this whole rearchitecture is
// about) a PM has no more business seeing another PM's or the admin's customer book than
// a platform admin has seeing any tenant's.
router.get("/", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { tenantId } = req.effective;
    await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(`SELECT * FROM contacts WHERE tenant_id = $1 ORDER BY lower(name) ASC`, [tenantId]);
      res.json(rows);
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { tenantId } = req.effective;
    await withTenant(tenantId, (client) =>
      client.query(`DELETE FROM contacts WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
