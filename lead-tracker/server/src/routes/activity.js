import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const FEED_LIMIT = 40;

// a single, chronologically-merged activity feed for the dashboard: lead
// and warranty stage moves for everyone, plus (owner-only) every time the
// project manager (viewer) has opened the app
router.get("/feed", requireAuth("viewer"), (req, res) => {
  const moves = db
    .prepare(`SELECT * FROM activity_log ORDER BY createdAt DESC LIMIT ?`)
    .all(FEED_LIMIT)
    .map((row) => ({ ...row, kind: "move" }));

  let entries = moves;
  if (req.role === "owner") {
    const access = db
      .prepare(`SELECT * FROM access_log WHERE role = 'viewer' ORDER BY createdAt DESC LIMIT ?`)
      .all(FEED_LIMIT)
      .map((row) => ({ ...row, kind: "access" }));
    entries = entries.concat(access);
  }

  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(entries.slice(0, FEED_LIMIT));
});

export default router;
