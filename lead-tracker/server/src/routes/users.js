import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { listTenantUsers, createTenantUser, setUserDisabled, setUserPassword } from "../auth/users.js";

const router = Router();

// Tenant-admin-only account-settings screen: add a PM (or a second tenant admin),
// disable/re-enable one, reset a password. Own-tenant only via withTenant/RLS.
router.get("/", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    res.json(await listTenantUsers(req.effective.tenantId));
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { email, name, password, role } = req.body || {};
    if (!email || !String(email).trim()) return res.status(400).json({ error: "Email is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
    if (!password || String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (role !== "pm" && role !== "tenant_admin") return res.status(400).json({ error: "role must be 'pm' or 'tenant_admin'" });

    const user = await createTenantUser(req.effective.tenantId, {
      email: String(email).trim(),
      name: String(name).trim(),
      password,
      role,
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.message?.includes("already exists")) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.post("/:id/disable", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    if (req.params.id === req.effective.userId) return res.status(400).json({ error: "Can't disable your own account" });
    res.json(await setUserDisabled(req.effective.tenantId, req.params.id, true));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/enable", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    res.json(await setUserDisabled(req.effective.tenantId, req.params.id, false));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reset-password", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    await setUserPassword(req.effective.tenantId, req.params.id, password);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
