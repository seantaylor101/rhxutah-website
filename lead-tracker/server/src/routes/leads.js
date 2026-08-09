import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const SOURCES = new Set(["referral", "referral_bni", "google", "facebook", "other"]);
const STAGES = new Set(["new", "bid", "lost", "won", "progress", "completed", "paid"]);
const EDITABLE_FIELDS = new Set(["createdAt", "startDate", "revenue", "name"]);

function rowToLead(row) {
  return { ...row, archived: !!row.archived };
}

function yearMonth(dateLike) {
  const d = new Date(dateLike);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

// Mirrors the old client-side sweep: paid leads roll into the archive once the
// calendar month they were paid in has passed.
function sweepArchive() {
  const thisMonth = yearMonth(new Date());
  const rows = db
    .prepare(`SELECT * FROM leads WHERE stage = 'paid' AND archived = 0 AND paidAt IS NOT NULL`)
    .all();
  const toSweep = rows.filter((row) => yearMonth(row.paidAt) !== thisMonth);
  if (!toSweep.length) return;

  const now = new Date().toISOString();
  const stmt = db.prepare(`UPDATE leads SET archived = 1, archivedAt = ? WHERE id = ?`);
  const tx = db.transaction((leads) => {
    for (const row of leads) stmt.run(now, row.id);
  });
  tx(toSweep);
}

function getLeadOr404(id, res) {
  const row = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  if (!row) {
    res.status(404).json({ error: "Lead not found" });
    return null;
  }
  return row;
}

router.get("/", requireAuth("viewer"), (req, res) => {
  sweepArchive();
  const rows = db.prepare(`SELECT * FROM leads ORDER BY createdAt DESC`).all();
  res.json(rows.map(rowToLead));
});

router.post("/", requireAuth("owner"), (req, res) => {
  const { name, source, sourceOther } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
  if (!source || !SOURCES.has(source)) return res.status(400).json({ error: "Valid source is required" });

  const lead = {
    id: randomUUID(),
    name: String(name).trim(),
    stage: "new",
    createdAt: new Date().toISOString(),
    startDate: "",
    revenue: null,
    wonAt: null,
    paidAt: null,
    source,
    sourceOther: source === "other" ? String(sourceOther || "").trim() : "",
    archived: 0,
    archivedAt: null,
  };

  db.prepare(
    `INSERT INTO leads (id, name, stage, createdAt, startDate, revenue, wonAt, paidAt, source, sourceOther, archived, archivedAt)
     VALUES (@id, @name, @stage, @createdAt, @startDate, @revenue, @wonAt, @paidAt, @source, @sourceOther, @archived, @archivedAt)`
  ).run(lead);

  res.status(201).json(rowToLead(lead));
});

// Stage transitions carry the same wonAt/paidAt side effects the original client applied.
router.post("/:id/move", requireAuth("owner"), (req, res) => {
  const { stage, date } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  let ts = new Date().toISOString();
  if (date) {
    const parsed = new Date(`${date}T00:00:00`);
    if (isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid date" });
    ts = parsed.toISOString();
  }

  const patch = { stage };
  if (stage === "won") patch.wonAt = ts;
  if (stage === "paid") patch.paidAt = ts;

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

router.patch("/:id", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
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

  const fields = Object.keys(updates);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });

  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

router.delete("/:id", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  db.prepare(`DELETE FROM leads WHERE id = ?`).run(row.id);
  res.status(204).end();
});

export default router;
