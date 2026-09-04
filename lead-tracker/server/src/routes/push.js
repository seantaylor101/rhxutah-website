import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { saveSubscription, removeSubscription } from "../pushService.js";

const router = Router();

router.get("/vapid-public-key", requireAuth("tenant_admin", "pm"), (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

router.post("/subscribe", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    await saveSubscription(req.effective.tenantId, req.effective.userId, sub);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/unsubscribe", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) await removeSubscription(req.effective.tenantId, endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
