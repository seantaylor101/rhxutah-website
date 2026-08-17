import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const LOG_LIMIT = 200;

// lead/warranty move history — viewer-level, same visibility as the board
// data it's describing
router.get("/log", requireAuth("viewer"), (req, res) => {
  const rows = db.prepare(`SELECT * FROM activity_log ORDER BY createdAt DESC LIMIT ?`).all(LOG_LIMIT);
  res.json(rows);
});

// when the project manager (viewer) has opened the app — owner-only
router.get("/access", requireAuth("owner"), (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM access_log WHERE role = 'viewer' ORDER BY createdAt DESC LIMIT ?`)
    .all(LOG_LIMIT);
  res.json(rows);
});

export default router;
