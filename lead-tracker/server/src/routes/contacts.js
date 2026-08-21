import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// owner-only end to end — this list exists so the owner isn't retyping a
// repeat customer's info, and it's nobody else's business to see
router.get("/", requireAuth("owner"), (req, res) => {
  const rows = db.prepare(`SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC`).all();
  res.json(rows);
});

router.delete("/:id", requireAuth("owner"), (req, res) => {
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

export default router;
