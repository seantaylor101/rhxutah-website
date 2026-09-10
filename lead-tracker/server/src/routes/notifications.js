import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// owner sees everything (including legacy rows written before alerts were
// scoped, which have no role on file); every other role sees only alerts
// addressed to it — a viewer never sees an owner-only alert like a new lead
// or a final-report nag they have no way to act on
router.get("/", requireAuth("viewer"), (req, res) => {
  const notifications =
    req.role === "owner"
      ? db.prepare(`SELECT * FROM notifications ORDER BY createdAt DESC LIMIT 50`).all()
      : db.prepare(`SELECT * FROM notifications WHERE role = ? ORDER BY createdAt DESC LIMIT 50`).all(req.role);
  const unread =
    req.role === "owner"
      ? db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE readAt IS NULL`).get().c
      : db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE readAt IS NULL AND role = ?`).get(req.role).c;
  res.json({ notifications, unread });
});

router.post("/:id/read", requireAuth("viewer"), (req, res) => {
  db.prepare(`UPDATE notifications SET readAt = ? WHERE id = ? AND readAt IS NULL`).run(
    new Date().toISOString(),
    req.params.id
  );
  res.json({ ok: true });
});

// scoped the same way as the list above — otherwise the PM tapping "mark all
// read" would also silently clear the owner's unread new-lead/report alerts
router.post("/read-all", requireAuth("viewer"), (req, res) => {
  if (req.role === "owner") {
    db.prepare(`UPDATE notifications SET readAt = ? WHERE readAt IS NULL`).run(new Date().toISOString());
  } else {
    db.prepare(`UPDATE notifications SET readAt = ? WHERE readAt IS NULL AND role = ?`).run(
      new Date().toISOString(),
      req.role
    );
  }
  res.json({ ok: true });
});

export default router;
