import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendDueReportReminders } from "../reportReminders.js";

const router = Router();

const SOURCES = new Set(["referral", "referral_bni", "google", "facebook", "website", "other"]);
const STAGES = new Set(["new", "bid", "lost", "won", "progress", "completed", "paid"]);
const EDITABLE_FIELDS = new Set(["createdAt", "startDate", "completedAt", "revenue", "name", "job", "phone", "email"]);

function rowToLead(row) {
  return { ...row, archived: !!row.archived };
}

// shared by the authenticated create route and the public website-intake route
export function insertLead(db, { name, job, phone, email, source, sourceOther }) {
  const lead = {
    id: randomUUID(),
    name: String(name).trim(),
    job: String(job || "").trim(),
    phone: String(phone || "").trim(),
    email: String(email || "").trim(),
    stage: "new",
    createdAt: new Date().toISOString(),
    startDate: "",
    revenue: null,
    bidSentAt: null,
    wonAt: null,
    completedAt: null,
    paidAt: null,
    source,
    sourceOther: source === "other" || source === "website" ? String(sourceOther || "").trim() : "",
    archived: 0,
    archivedAt: null,
  };

  db.prepare(
    `INSERT INTO leads (id, name, job, phone, email, stage, createdAt, startDate, revenue, bidSentAt, wonAt, completedAt, paidAt, source, sourceOther, archived, archivedAt)
     VALUES (@id, @name, @job, @phone, @email, @stage, @createdAt, @startDate, @revenue, @bidSentAt, @wonAt, @completedAt, @paidAt, @source, @sourceOther, @archived, @archivedAt)`
  ).run(lead);

  return lead;
}

export { SOURCES };

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
  const leads = rows.map(rowToLead);
  // profit is owner-only: strip the cost inputs at the API layer too, not
  // just in the UI, so a viewer can't recover them by inspecting the response
  if (req.role !== "owner") {
    for (const lead of leads) {
      lead.materialCost = null;
      lead.laborCost = null;
    }
  }
  res.json(leads);
});

router.post("/", requireAuth("owner"), (req, res) => {
  const { name, job, phone, email, source, sourceOther } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
  if (!source || !SOURCES.has(source)) return res.status(400).json({ error: "Valid source is required" });

  const lead = insertLead(db, { name, job, phone, email, source, sourceOther });
  res.status(201).json(rowToLead(lead));
});

// Stage transitions carry the same bidSentAt/wonAt/completedAt/paidAt side
// effects the original client applied — these timestamps double as the raw
// data for the performance-metrics breakdowns (time in each stage, etc).
const AT_OR_AFTER_BID = new Set(["bid", "lost", "won", "progress", "completed", "paid"]);
const AT_OR_AFTER_WON = new Set(["won", "progress", "completed", "paid"]);
const AT_OR_AFTER_COMPLETED = new Set(["completed", "paid"]);

router.post("/:id/move", requireAuth("owner"), (req, res) => {
  const { stage, date, revert } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  let ts = new Date().toISOString();
  if (date) {
    // build the UTC-midnight timestamp directly instead of parsing
    // `${date}T00:00:00` (no zone) through Date, which is interpreted in
    // whatever timezone this process happens to run in — explicit UTC
    // keeps backdated stage timestamps consistent regardless of that
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid date" });
    ts = parsed.toISOString();
  }

  const patch = { stage };
  if (revert) {
    // moving a lead backward: never stamp a fresh date, only clear ones that
    // no longer apply so stats don't stay wrong after the revert
    if (!AT_OR_AFTER_BID.has(stage)) {
      patch.bidSentAt = null;
    }
    if (!AT_OR_AFTER_WON.has(stage)) {
      patch.wonAt = null;
      patch.paidAt = null;
    } else if (stage !== "paid") {
      patch.paidAt = null;
    }
    if (!AT_OR_AFTER_COMPLETED.has(stage)) {
      patch.completedAt = null;
    }
  } else if (stage === "bid") {
    patch.bidSentAt = ts;
  } else if (stage === "won") {
    patch.wonAt = ts;
    patch.paidAt = null;
  } else if (stage === "completed") {
    patch.completedAt = ts;
    patch.paidAt = null;
  } else if (stage === "paid") {
    patch.paidAt = ts;
  } else if (stage === "progress") {
    patch.paidAt = null;
  } else {
    // new / lost
    patch.wonAt = null;
    patch.paidAt = null;
    if (stage === "new") patch.bidSentAt = null;
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));

  // a lead just landed in "completed" — send the first "complete final
  // report" reminder right away instead of waiting for the next hourly sweep
  if (!revert && stage === "completed") {
    sendDueReportReminders().catch((err) => console.error("report reminder sweep failed:", err.message));
  }
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
  if ("job" in updates) {
    updates.job = String(updates.job || "").trim();
  }

  const fields = Object.keys(updates);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });

  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

router.patch("/:id/report", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const { materialCost, laborCost, wentWell, wentWrong, markComplete } = req.body || {};
  const patch = {};
  if (materialCost !== undefined) {
    patch.materialCost = materialCost === null || materialCost === "" ? null : Number(materialCost);
  }
  if (laborCost !== undefined) {
    patch.laborCost = laborCost === null || laborCost === "" ? null : Number(laborCost);
  }
  if (wentWell !== undefined) patch.wentWell = String(wentWell || "").trim();
  if (wentWrong !== undefined) patch.wentWrong = String(wentWrong || "").trim();
  if (markComplete === true) patch.reportCompletedAt = new Date().toISOString();
  if (markComplete === false) patch.reportCompletedAt = null;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "No editable fields given" });
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
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
