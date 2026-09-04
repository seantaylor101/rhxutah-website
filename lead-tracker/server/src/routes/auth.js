import { Router } from "express";
import { COOKIE_NAME, signSession } from "../auth/session.js";
import { requireAuth } from "../auth/middleware.js";
import { findUserForLogin, markLoggedIn } from "../auth/users.js";
import { verifyPassword } from "../auth/passwords.js";
import { startViewAs, stopViewAs } from "../auth/impersonation.js";
import { logAccess } from "../activityLog.js";

const router = Router();
const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Small in-memory per-IP limiter -- the login endpoint is the actual front door, so it
// needs its own throttle independent of anything downstream (mirrors the limiter on the
// public intake route).
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of attempts) {
    if (!timestamps.some((t) => now - t < WINDOW_MS)) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

function publicUser(row) {
  return { id: row.id, tenantId: row.tenant_id, email: row.email, name: row.name, role: row.role };
}

router.post("/login", async (req, res, next) => {
  try {
    if (isRateLimited(req.ip)) {
      return res.status(429).json({ error: "Too many attempts — try again later" });
    }

    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const row = await findUserForLogin(email);
    const ok = row && (await verifyPassword(password, row.password_hash));
    if (!ok) return res.status(401).json({ error: "Incorrect email or password" });

    if (row.role === "pm") await logAccess(row.tenant_id, row.id);
    markLoggedIn(row.id).catch(() => {});

    const token = signSession({ userId: row.id, tenantId: row.tenant_id, role: row.role });
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isProd });
  res.json({ ok: true });
});

router.get("/me", requireAuth(), async (req, res, next) => {
  try {
    if (req.effective.role === "pm") await logAccess(req.effective.tenantId, req.effective.userId);
    res.json({
      actor: req.actor,
      effective: req.effective,
      viewingAs: Boolean(req.session.actingAs),
    });
  } catch (err) {
    next(err);
  }
});

// Registered before the /:userId route below -- Express matches routes in registration
// order, and "stop" would otherwise be captured as :userId and hit the wrong handler.
// requireAuth() here deliberately checks the real actor's session validity only (no role
// restriction), since req.effective.role is whatever's being impersonated right now, not
// the actor's own authority -- gating this on req.effective.role would make it
// impossible to stop viewing as someone whose role isn't tenant_admin/platform_admin.
router.post("/view-as/stop", requireAuth(), async (req, res, next) => {
  try {
    if (!req.session.actingAs) return res.status(400).json({ error: "Not currently viewing as anyone" });
    const token = await stopViewAs({
      actor: req.actor,
      tenantId: req.actor.tenantId,
      actingAsUserId: req.session.actingAs.userId,
      actingAsRole: req.session.actingAs.role,
    });
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Tenant admin viewing as one of their own PMs, or platform admin viewing as a
// tenant_admin for support. Every start/stop is written to audit_log.
router.post("/view-as/:userId", requireAuth("tenant_admin", "platform_admin"), async (req, res, next) => {
  try {
    const { token, target } = await startViewAs({ actor: req.actor, targetUserId: req.params.userId });
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.json({ viewingAs: target });
  } catch (err) {
    if (err.message?.includes("not found")) return res.status(404).json({ error: err.message });
    next(err);
  }
});

export default router;
