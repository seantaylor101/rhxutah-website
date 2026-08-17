import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { saveSubscription, removeSubscription } from "../pushService.js";

const router = Router();

router.get("/vapid-public-key", requireAuth("viewer"), (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

router.post("/subscribe", requireAuth("viewer"), (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  // push targeting still speaks "owner"/"viewer" (see pushService.js/goalReminders.js/etc)
  // — admin maps to "owner" so financial/goal reminders keep reaching them,
  // everyone else maps to "viewer" so team-wide notices (e.g. "lead won")
  // keep reaching the crew, same as the old shared-passcode roles did
  saveSubscription(sub, req.user.isAdmin ? "owner" : "viewer");
  res.status(201).json({ ok: true });
});

router.post("/unsubscribe", requireAuth("viewer"), (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) removeSubscription(endpoint);
  res.json({ ok: true });
});

export default router;
