import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

function readSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    dailyOverheadCost: Number(map.dailyOverheadCost ?? 350),
  };
}

router.get("/", requireAuth("viewer"), (req, res) => {
  res.json(readSettings());
});

router.patch("/", requireAuth("owner"), (req, res) => {
  const { dailyOverheadCost } = req.body || {};
  if (dailyOverheadCost === undefined) {
    return res.status(400).json({ error: "No editable fields given" });
  }
  const n = Number(dailyOverheadCost);
  if (!Number.isFinite(n) || n < 0) {
    return res.status(400).json({ error: "dailyOverheadCost must be a non-negative number" });
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('dailyOverheadCost', @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ value: String(n) });
  res.json(readSettings());
});

export default router;
