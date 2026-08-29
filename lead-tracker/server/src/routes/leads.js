import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendDueReportReminders } from "../reportReminders.js";
import { sendPushToRole } from "../pushService.js";
import { logMove } from "../activityLog.js";
import { upsertContactFromLead, updateContact } from "../contacts.js";

const router = Router();

const SOURCES = new Set(["referral", "referral_bni", "google", "facebook", "website", "other"]);
const STAGES = new Set(["new", "bid", "lost", "won", "progress", "completed", "paid"]);
const EDITABLE_FIELDS = new Set([
  "createdAt",
  "startDate",
  "completedAt",
  "revenue",
  "name",
  "job",
  "phone",
  "email",
  "address",
  "source",
  "sourceOther",
  "appointmentAt",
  "manager",
]);

const VALID_MANAGERS = new Set(["Sean", "Dave"]);

function rowToLead(row) {
  let scopeOfWork = [];
  if (row.scopeOfWork) {
    try {
      scopeOfWork = JSON.parse(row.scopeOfWork);
    } catch {
      scopeOfWork = [];
    }
  }
  let followUps = [];
  if (row.followUps) {
    try {
      followUps = JSON.parse(row.followUps);
    } catch {
      followUps = [];
    }
  }
  return { ...row, archived: !!row.archived, scopeOfWork, followUps };
}

// shared by the authenticated create route and the public website-intake route
export function insertLead(db, { name, job, phone, email, source, sourceOther }) {
  const lead = {
    id: randomUUID(),
    name: String(name).trim(),
    job: String(job || "").trim(),
    phone: String(phone || "").trim(),
    email: String(email || "").trim(),
    address: "",
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
    scopeOfWork: "",
    contactId: null,
  };

  // keeps the owner's contacts list current regardless of whether the lead
  // came from the authenticated form or the public website-intake endpoint
  lead.contactId = upsertContactFromLead(
    db,
    { name: lead.name, phone: lead.phone, email: lead.email, address: lead.address },
    { isNewLead: true }
  );

  db.prepare(
    `INSERT INTO leads (id, name, job, phone, email, address, stage, createdAt, startDate, revenue, bidSentAt, wonAt, completedAt, paidAt, source, sourceOther, archived, archivedAt, scopeOfWork, contactId)
     VALUES (@id, @name, @job, @phone, @email, @address, @stage, @createdAt, @startDate, @revenue, @bidSentAt, @wonAt, @completedAt, @paidAt, @source, @sourceOther, @archived, @archivedAt, @scopeOfWork, @contactId)`
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
      lead.commission = null;
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

// viewer-level so the project manager can advance a job from "in progress"
// to "completed" — every other transition (including reverts) stays
// owner-only, enforced below since requireAuth only checks the floor
router.post("/:id/move", requireAuth("viewer"), (req, res) => {
  const { stage, date, revert, workDays } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  if (req.role !== "owner") {
    const viewerAllowed = !revert && row.stage === "progress" && stage === "completed";
    if (!viewerAllowed) return res.status(403).json({ error: "Editor access required" });
  }

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
  // lostAt only ever applies to the "lost" stage itself — any move to
  // anything else (including a revert) means the lead isn't lost anymore
  if (stage !== "lost") patch.lostAt = null;
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
      patch.actualWorkDays = null;
    }
  } else if (stage === "bid") {
    patch.bidSentAt = ts;
  } else if (stage === "won") {
    patch.wonAt = ts;
    patch.paidAt = null;
  } else if (stage === "completed") {
    patch.completedAt = ts;
    patch.paidAt = null;
    if (workDays !== undefined && workDays !== null && workDays !== "") {
      const n = Number(workDays);
      if (!isNaN(n) && n > 0) patch.actualWorkDays = n;
    }
  } else if (stage === "paid") {
    patch.paidAt = ts;
  } else if (stage === "progress") {
    patch.paidAt = null;
  } else if (stage === "lost") {
    // a lead can be marked lost from any point in the process (a won job
    // can still fall through before it starts, a job in progress can get
    // cancelled, etc) — clear every later-stage timestamp so stats keep
    // reading this as "not won" regardless of how far it got. bidSentAt is
    // deliberately kept: the bid was still genuinely sent
    patch.wonAt = null;
    patch.paidAt = null;
    patch.completedAt = null;
    patch.actualWorkDays = null;
    patch.lostAt = ts;
  } else {
    // new (reopen)
    patch.wonAt = null;
    patch.paidAt = null;
    patch.bidSentAt = null;
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));

  logMove({
    type: "lead",
    entityId: row.id,
    entityName: row.name,
    fromStage: row.stage,
    toStage: stage,
    role: req.role,
  });

  // a lead just landed in "completed" — send the first "complete final
  // report" reminder right away instead of waiting for the next hourly sweep
  if (!revert && stage === "completed") {
    sendDueReportReminders().catch((err) => console.error("report reminder sweep failed:", err.message));
  }

  // no push here anymore on a fresh win — the client prompts for who's
  // managing the job right after this move resolves, and that's what
  // actually triggers the "Lead won!" push (see PATCH /:id below), so Dave
  // only hears about it when he's the one tagged on it
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
  if ("source" in updates) {
    if (!SOURCES.has(updates.source)) return res.status(400).json({ error: "Invalid source" });
  }
  if ("sourceOther" in updates) {
    updates.sourceOther = String(updates.sourceOther || "").trim();
  }
  if ("appointmentAt" in updates) {
    updates.appointmentAt = updates.appointmentAt || null;
    // a changed/cleared appointment needs its own fresh 7am reminder, not the
    // old appointment's already-sent flag silently suppressing it
    updates.appointmentReminderSentAt = null;
  }
  if ("manager" in updates) {
    updates.manager = updates.manager || null;
    if (updates.manager && !VALID_MANAGERS.has(updates.manager)) {
      return res.status(400).json({ error: "manager must be 'Sean' or 'Dave'" });
    }
  }

  const fields = Object.keys(updates);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });

  // the "Lead won!" push only fires once Dave is actually tagged as the
  // manager on a job that's still sitting at "won" (not, say, a manager
  // correction made weeks later once the job's already in progress) — see
  // routes/leads.js POST /:id/move, which used to send this unconditionally
  if (updates.manager === "Dave" && row.stage === "won") {
    sendPushToRole("viewer", {
      title: "Lead won!",
      body: `${row.name} has been won and tagged to you. Please contact the salesman and the customer and schedule the work ASAP.`,
      leadId: row.id,
    }).catch((err) => console.error("won push notify failed:", err.message));
  }

  if (["name", "phone", "email", "address"].some((f) => f in updates)) {
    const merged = { ...row, ...updates };
    const contactInfo = { name: merged.name, phone: merged.phone, email: merged.email, address: merged.address };
    if (row.contactId) {
      updateContact(db, row.contactId, contactInfo);
    } else {
      // pre-migration lead with no link yet — match-or-create once, then
      // remember it so every future edit goes straight to updateContact
      const contactId = upsertContactFromLead(db, contactInfo, { isNewLead: false });
      db.prepare(`UPDATE leads SET contactId = ? WHERE id = ?`).run(contactId, row.id);
    }
  }

  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

// viewer-level so the project manager can schedule/reschedule a won job's
// start date without needing owner access — restricted to jobs that have
// actually been won (not e.g. a still-open bid) and to just this one field,
// unlike the owner-only general-purpose PATCH /:id above
router.patch("/:id/start-date", requireAuth("viewer"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  if (!AT_OR_AFTER_WON.has(row.stage)) {
    return res.status(403).json({ error: "Start date can only be set on a won job" });
  }

  const { startDate } = req.body || {};
  if (startDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) {
    return res.status(400).json({ error: "startDate must be YYYY-MM-DD or empty" });
  }

  db.prepare(`UPDATE leads SET startDate = ? WHERE id = ?`).run(startDate, row.id);
  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

router.patch("/:id/report", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const { materialCost, laborCost, commission, actualWorkDays, wentWell, wentWrong, markComplete } = req.body || {};
  const patch = {};
  if (materialCost !== undefined) {
    patch.materialCost = materialCost === null || materialCost === "" ? null : Number(materialCost);
  }
  if (laborCost !== undefined) {
    patch.laborCost = laborCost === null || laborCost === "" ? null : Number(laborCost);
  }
  if (commission !== undefined) {
    patch.commission = commission === null || commission === "" ? null : Number(commission);
  }
  if (actualWorkDays !== undefined) {
    patch.actualWorkDays = actualWorkDays === null || actualWorkDays === "" ? null : Number(actualWorkDays);
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

function readScopeOfWork(row) {
  if (!row.scopeOfWork) return [];
  try {
    return JSON.parse(row.scopeOfWork);
  } catch {
    return [];
  }
}

// full replace of the scope-of-work checklist — owner-only, used both for
// the initial fill-out right after marking a lead won and for later edits
// to the item list
router.put("/:id/scope-of-work", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: "items array is required" });

  const cleaned = [];
  for (const item of items) {
    const text = String(item?.text || "").trim();
    if (!text) continue;
    cleaned.push({
      id: typeof item?.id === "string" && item.id ? item.id : randomUUID(),
      text,
      done: !!item?.done,
    });
  }

  db.prepare(`UPDATE leads SET scopeOfWork = ? WHERE id = ?`).run(JSON.stringify(cleaned), row.id);
  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

// toggling a single item's done state — viewer-level so the project
// manager can check items off as the crew works through them
router.patch("/:id/scope-of-work", requireAuth("viewer"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const { itemId, done } = req.body || {};
  if (!itemId) return res.status(400).json({ error: "itemId is required" });

  const items = readScopeOfWork(row);
  const item = items.find((i) => i.id === itemId);
  if (!item) return res.status(404).json({ error: "Checklist item not found" });
  item.done = !!done;

  db.prepare(`UPDATE leads SET scopeOfWork = ? WHERE id = ?`).run(JSON.stringify(items), row.id);
  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

function readFollowUps(row) {
  if (!row.followUps) return [];
  try {
    return JSON.parse(row.followUps);
  } catch {
    return [];
  }
}

// logs one follow-up touch (call/text/email) — owner-only, same as every
// other sales-side action on a lead
router.post("/:id/followups", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const followUps = readFollowUps(row);
  followUps.push({ id: randomUUID(), createdAt: new Date().toISOString() });

  db.prepare(`UPDATE leads SET followUps = ? WHERE id = ?`).run(JSON.stringify(followUps), row.id);
  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

// undo an accidental log
router.delete("/:id/followups/:followupId", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const followUps = readFollowUps(row).filter((f) => f.id !== req.params.followupId);

  db.prepare(`UPDATE leads SET followUps = ? WHERE id = ?`).run(JSON.stringify(followUps), row.id);
  res.json(rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id)));
});

router.delete("/:id", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  db.prepare(`DELETE FROM leads WHERE id = ?`).run(row.id);
  res.status(204).end();
});

export default router;
