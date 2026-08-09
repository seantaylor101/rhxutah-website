import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.get("/", requireAuth("viewer"), (req, res) => {
  const notifications = db.prepare(`SELECT * FROM notifications ORDER BY createdAt DESC LIMIT 50`).all();
  const unread = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE readAt IS NULL`).get().c;
  res.json({ notifications, unread });
});

router.post("/:id/read", requireAuth("viewer"), (req, res) => {
  db.prepare(`UPDATE notifications SET readAt = ? WHERE id = ? AND readAt IS NULL`).run(
    new Date().toISOString(),
    req.params.id
  );
  res.json({ ok: true });
});

router.post("/read-all", requireAuth("viewer"), (req, res) => {
  db.prepare(`UPDATE notifications SET readAt = ? WHERE readAt IS NULL`).run(new Date().toISOString());
  res.json({ ok: true });
});

export default router;
