import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendPushToRole } from "../pushService.js";

const router = Router();

const STAGES = new Set(["reported", "scheduled", "resolved"]);
const EDITABLE_FIELDS = new Set(["name", "phone", "email", "issue", "createdAt"]);

router.get("/", requireAuth("viewer"), (req, res) => {
  const rows = db.prepare(`SELECT * FROM warranty_requests ORDER BY createdAt DESC`).all();
  res.json(rows);
});

router.post("/", requireAuth("owner"), (req, res) => {
  const { name, phone, email, issue } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });

  const row = {
    id: randomUUID(),
    name: String(name).trim(),
    phone: String(phone || "").trim(),
    email: String(email || "").trim(),
    issue: String(issue || "").trim(),
    stage: "reported",
    createdAt: new Date().toISOString(),
    scheduledAt: null,
    resolvedAt: null,
  };

  db.prepare(
    `INSERT INTO warranty_requests (id, name, phone, email, issue, stage, createdAt, scheduledAt, resolvedAt)
     VALUES (@id, @name, @phone, @email, @issue, @stage, @createdAt, @scheduledAt, @resolvedAt)`
  ).run(row);

  res.status(201).json(row);

  // best-effort — the request is already saved, don't let a push hiccup
  // affect the response
  sendPushToRole("viewer", {
    title: "New warranty request",
    body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
  }).catch((err) => console.error("warranty push notify failed:", err.message));
});

function getOr404(id, res) {
  const row = db.prepare(`SELECT * FROM warranty_requests WHERE id = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: "Warranty request not found" });
    return null;
  }
  return row;
}

// viewer-level so both roles can move a request through the pipeline —
// adding, editing, and deleting requests stay owner-only below
router.post("/:id/move", requireAuth("viewer"), (req, res) => {
  const { stage, revert } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });
  const row = getOr404(req.params.id, res);
  if (!row) return;

  const ts = new Date().toISOString();
  const patch = { stage };
  if (revert) {
    if (stage !== "scheduled") patch.scheduledAt = null;
    patch.resolvedAt = null;
  } else if (stage === "scheduled") {
    patch.scheduledAt = ts;
  } else if (stage === "resolved") {
    patch.resolvedAt = ts;
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE warranty_requests SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(db.prepare(`SELECT * FROM warranty_requests WHERE id = ?`).get(row.id));

  // best-effort — the move is already saved, don't let a push hiccup affect
  // the response
  if (!revert && stage === "resolved") {
    sendPushToRole("owner", {
      title: "Warranty request resolved",
      body: `${row.name}${row.issue ? " — " + row.issue : ""}`,
    }).catch((err) => console.error("warranty resolved push notify failed:", err.message));
  }
});

router.patch("/:id", requireAuth("owner"), (req, res) => {
  const row = getOr404(req.params.id, res);
  if (!row) return;

  const updates = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (EDITABLE_FIELDS.has(key)) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No editable fields given" });
  }
  if ("name" in updates) {
    updates.name = String(updates.name).trim();
    if (!updates.name) return res.status(400).json({ error: "Name can't be empty" });
  }
  if ("phone" in updates) updates.phone = String(updates.phone || "").trim();
  if ("email" in updates) updates.email = String(updates.email || "").trim();
  if ("issue" in updates) updates.issue = String(updates.issue || "").trim();

  const fields = Object.keys(updates);
  db.prepare(`UPDATE warranty_requests SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });

  res.json(db.prepare(`SELECT * FROM warranty_requests WHERE id = ?`).get(row.id));
});

router.delete("/:id", requireAuth("owner"), (req, res) => {
  const row = getOr404(req.params.id, res);
  if (!row) return;
  db.prepare(`DELETE FROM warranty_requests WHERE id = ?`).run(row.id);
  res.status(204).end();
});

export default router;
