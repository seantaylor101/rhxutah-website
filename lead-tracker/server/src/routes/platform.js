import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { withPlatform } from "../db/pool.js";
import { createTenantWithAdmin } from "../auth/users.js";

const router = Router();

// Platform-admin-only: onboard/list/suspend tenants, plus a basic health signal for
// each (user counts, most recent login). Deliberately thin -- it only ever touches
// tenants/users/audit_log (via the platform pool, which has no grant on any business
// table), never a tenant's leads/contacts/warranty/goals/settings. last_login_at on
// `users` is the one activity signal available without crossing that boundary.
router.get("/tenants", requireAuth("platform_admin"), async (req, res, next) => {
  try {
    const { rows } = await withPlatform((client) =>
      client.query(`
        SELECT
          t.*,
          COUNT(u.id) FILTER (WHERE u.disabled_at IS NULL) AS active_user_count,
          COUNT(u.id) FILTER (WHERE u.role = 'pm' AND u.disabled_at IS NULL) AS active_pm_count,
          MAX(u.last_login_at) AS last_active_at
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `)
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        timezone: r.timezone,
        status: r.status,
        createdAt: r.created_at,
        activeUserCount: Number(r.active_user_count),
        activePmCount: Number(r.active_pm_count),
        lastActiveAt: r.last_active_at,
      }))
    );
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
