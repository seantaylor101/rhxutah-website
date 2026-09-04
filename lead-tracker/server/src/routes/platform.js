import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { withPlatform } from "../db/pool.js";
import { listTenants, createTenantWithAdmin } from "../auth/users.js";

const router = Router();

// Platform-admin-only: onboard/list/suspend tenants. Deliberately thin -- it only ever
// touches tenants/users/audit_log (via the platform pool, which has no grant on any
// business table), never a tenant's leads/contacts/warranty/goals/settings.
router.get("/tenants", requireAuth("platform_admin"), async (req, res, next) => {
  try {
    res.json(await listTenants());
  } catch (err) {
    next(err);
  }
});

router.post("/tenants", requireAuth("platform_admin"), async (req, res, next) => {
  try {
    const { tenantName, slug, timezone, adminEmail, adminName, password } = req.body || {};
    if (!tenantName || !String(tenantName).trim()) return res.status(400).json({ error: "tenantName is required" });
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: "slug must be lowercase letters, digits, hyphens" });
    if (!adminEmail || !String(adminEmail).trim()) return res.status(400).json({ error: "adminEmail is required" });
    if (!adminName || !String(adminName).trim()) return res.status(400).json({ error: "adminName is required" });
    if (!password || String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const result = await createTenantWithAdmin({
      tenantName: String(tenantName).trim(),
      slug,
      timezone,
      adminEmail: String(adminEmail).trim(),
      adminName: String(adminName).trim(),
      password,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That slug or email is already in use" });
    next(err);
  }
});

router.post("/tenants/:id/suspend", requireAuth("platform_admin"), async (req, res, next) => {
  try {
    await withPlatform((client) => client.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [req.params.id]));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/tenants/:id/reactivate", requireAuth("platform_admin"), async (req, res, next) => {
  try {
    await withPlatform((client) => client.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [req.params.id]));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
