import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendDueReportReminders } from "../reportReminders.js";
import { sendPushToRole } from "../pushService.js";
import { logMove } from "../activityLog.js";
import { upsertContactFromLead, updateContact } from "../contacts.js";
import { localMonthKey } from "../businessTime.js";
import { parseJobDetails, applyJobDetailsPatch } from "../jobDetails.js";
import { cleanReportTags, parseReportTags } from "../jobReportTags.js";
import { cleanEstimateBasics, parseEstimateBasics, missingEstimateBasics } from "../../../shared/estimateBasics.js";
import { syncLeadToJobTread, jobtreadConfigured, jobUrl, PossibleDuplicateError } from "../jobtread.js";
import { reviewDraft } from "../estimateReview.js";
import { sendPreview, sendApprovedProposal, SendRefused } from "../proposalSend.js";
import { cleanTradeAnswers, missingTradeAnswers, AUTOMATED_TRADES } from "../../../shared/tradeQuestions.js";
import { draftEstimate } from "../estimateDraft.js";
import {
  parsePayees,
  validatePayeeInput,
  addPayee,
  updatePayee,
  removePayee,
  validatePaymentInput,
  addPayment,
  removePayment,
} from "../payeeTracking.js";
import { jobMediaUpload, jobMediaKind, JOB_MEDIA_DIR, SAFE_JOB_MEDIA_FILENAME } from "../uploads.js";
import { validateMeasureData, parseMeasureData } from "../measureData.js";
import { buildPayeePdf } from "../payeePdf.js";
import { deleteMeasureDataForLead } from "./measure.js";

const router = Router();

const SOURCES = new Set(["referral", "referral_bni", "google", "facebook", "website", "other"]);
const STAGES = new Set(["new", "insurance", "bid", "lost", "won", "scheduled", "progress", "completed", "paid"]);
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
  "actualWorkDays",
]);

// a positive number of (fractional, quarter-day-ish) work days, or empty/
// null to clear — shared between the owner's general-purpose PATCH /:id
// below and the viewer-level PATCH /:id/start-date's optional estimate
function parseWorkDays(value) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

const VALID_MANAGERS = new Set(["Sean", "Dave"]);

// the insurance stage's checklist, in order — checking "jobWon" moves the
// lead on to "won" like any other win
export const INSURANCE_STEPS = [
  "initialInspection",
  "claimLetterSent",
  "itelSent",
  "supplementSent",
  "costingComplete",
  "finalEstimateSent",
  "jobWon",
];
const INSURANCE_STEP_SET = new Set(INSURANCE_STEPS);

function parseInsuranceChecklist(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const key of INSURANCE_STEPS) if (typeof parsed[key] === "string") out[key] = parsed[key];
    return out;
  } catch {
    return {};
  }
}

function shareTokenFor(leadId) {
  const row = db.prepare(`SELECT token FROM lead_shares WHERE leadId = ?`).get(leadId);
  return row ? row.token : null;
}

function mediaFor(leadId) {
  return db
    .prepare(`SELECT id, filename, kind, createdAt, measureData FROM lead_media WHERE leadId = ? ORDER BY createdAt ASC`)
    .all(leadId)
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      createdAt: m.createdAt,
      url: `/api/leads/media/${m.filename}`,
      measureData: parseMeasureData(m.measureData),
    }));
}

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
  return { ...row, archived: !!row.archived, insurance: !!row.insurance, insuranceChecklist: parseInsuranceChecklist(row.insuranceChecklist), scopeOfWork, followUps, jobDetails: parseJobDetails(row.jobDetails), estimateBasics: parseEstimateBasics(row.estimateBasics), jobtread: parseJobtreadLink(row.jobtread), tradeAnswers: parseTradeAnswers(row.tradeAnswers), media: mediaFor(row.id), shareToken: shareTokenFor(row.id), payees: parsePayees(row.payees), reportTags: parseReportTags(row.reportTags) };
}

// shared by the authenticated create route and the public website-intake route
export function insertLead(db, { name, job, phone, email, source, sourceOther, insurance }) {
  const lead = {
    id: randomUUID(),
    name: String(name).trim(),
    job: String(job || "").trim(),
    phone: String(phone || "").trim(),
    email: String(email || "").trim(),
    address: "",
    // insurance jobs skip "new" and start in their own bucket
    stage: insurance ? "insurance" : "new",
    insurance: insurance ? 1 : 0,
    insuranceChecklist: "",
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
    `INSERT INTO leads (id, name, job, phone, email, address, stage, createdAt, startDate, revenue, bidSentAt, wonAt, completedAt, paidAt, source, sourceOther, archived, archivedAt, scopeOfWork, contactId, insurance, insuranceChecklist)
     VALUES (@id, @name, @job, @phone, @email, @address, @stage, @createdAt, @startDate, @revenue, @bidSentAt, @wonAt, @completedAt, @paidAt, @source, @sourceOther, @archived, @archivedAt, @scopeOfWork, @contactId, @insurance, @insuranceChecklist)`
  ).run(lead);

  return lead;
}

export { SOURCES };

// Mirrors the old client-side sweep: paid leads roll into the archive once the
// calendar month they were paid in has passed — in business-local time, so a
// job paid earlier today doesn't get swept while it's still today just
// because UTC has already ticked into the next month.
function sweepArchive() {
  const thisMonth = localMonthKey();
  const rows = db
    .prepare(`SELECT * FROM leads WHERE stage = 'paid' AND archived = 0 AND paidAt IS NOT NULL`)
    .all();
  const toSweep = rows.filter((row) => localMonthKey(new Date(row.paidAt)) !== thisMonth);
  if (!toSweep.length) return;

  const now = new Date().toISOString();
  const stmt = db.prepare(`UPDATE leads SET archived = 1, archivedAt = ? WHERE id = ?`);
  const tx = db.transaction((leads) => {
    for (const row of leads) stmt.run(now, row.id);
  });
  tx(toSweep);
}

// materialCost/laborCost/commission/payees are all owner-only financial
// data — strip them for any non-owner response, not just the list endpoint,
// so a viewer can't recover them from a move/edit response either
function forRole(role, lead) {
  if (role !== "owner") {
    lead.materialCost = null;
    lead.laborCost = null;
    lead.commission = null;
    // the PM still needs to see who's on the job (for the per-sub materials
    // check-offs), just not what they're being paid — strip the financial
    // parts of each payee rather than the whole list
    lead.payees = (lead.payees || []).map((p) => ({ id: p.id, name: p.name, role: p.role }));
    // customer type, budget and the rest are for estimating, not the crew
    delete lead.estimateBasics;
    delete lead.jobtread;
    delete lead.tradeAnswers;
  }
  return lead;
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
  const leads = rows.map((row) => forRole(req.role, rowToLead(row)));
  res.json(leads);
});

router.post("/", requireAuth("owner"), (req, res) => {
  const { name, job, phone, email, source, sourceOther, insurance } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
  if (!source || !SOURCES.has(source)) return res.status(400).json({ error: "Valid source is required" });

  const lead = insertLead(db, { name, job, phone, email, source, sourceOther, insurance: insurance === true });
  res.status(201).json(forRole(req.role, rowToLead(lead)));
});

// Stage transitions carry the same bidSentAt/wonAt/completedAt/paidAt side
// effects the original client applied — these timestamps double as the raw
// data for the performance-metrics breakdowns (time in each stage, etc).
const AT_OR_AFTER_BID = new Set(["bid", "lost", "won", "scheduled", "progress", "completed", "paid"]);
const AT_OR_AFTER_WON = new Set(["won", "scheduled", "progress", "completed", "paid"]);
const AT_OR_AFTER_SCHEDULED = new Set(["scheduled", "progress", "completed", "paid"]);
const AT_OR_AFTER_COMPLETED = new Set(["completed", "paid"]);

// viewer-level so the project manager can schedule a won job, start a
// scheduled job, and advance an in-progress job to completed — every other
// transition (including reverts) stays owner-only, enforced below since
// requireAuth only checks the floor
const VIEWER_MOVE_TRANSITIONS = new Set(["won:scheduled", "scheduled:progress", "progress:completed"]);
router.post("/:id/move", requireAuth("viewer"), (req, res) => {
  const { stage, date, revert, workDays } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  if (req.role !== "owner") {
    const viewerAllowed = !revert && VIEWER_MOVE_TRANSITIONS.has(`${row.stage}:${stage}`);
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
    if (!AT_OR_AFTER_SCHEDULED.has(stage)) {
      patch.scheduledAt = null;
    }
    if (!AT_OR_AFTER_COMPLETED.has(stage)) {
      patch.completedAt = null;
      patch.actualWorkDays = null;
    }
  } else if (stage === "bid") {
    patch.bidSentAt = ts;
  } else if (stage === "won") {
    patch.wonAt = ts;
    patch.scheduledAt = null;
    patch.paidAt = null;
  } else if (stage === "scheduled") {
    patch.scheduledAt = ts;
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
    patch.scheduledAt = null;
    patch.paidAt = null;
    patch.completedAt = null;
    patch.actualWorkDays = null;
    patch.lostAt = ts;
  } else {
    // new / insurance (reopen)
    patch.wonAt = null;
    patch.scheduledAt = null;
    patch.paidAt = null;
    patch.bidSentAt = null;
  }

  // back in the insurance bucket means it isn't won anymore — uncheck that
  // step so the checklist matches where the lead actually sits
  if (stage === "insurance") {
    const checklist = parseInsuranceChecklist(row.insuranceChecklist);
    delete checklist.jobWon;
    patch.insuranceChecklist = JSON.stringify(checklist);
    patch.insurance = 1;
  } else if (stage === "new") {
    // "not insurance — move to New" (or reopening a regular lead)
    patch.insurance = 0;
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));

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
  if ("actualWorkDays" in updates) {
    const parsed = parseWorkDays(updates.actualWorkDays);
    if (!parsed.ok) return res.status(400).json({ error: "actualWorkDays must be a positive number" });
    updates.actualWorkDays = parsed.value;
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

  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
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

  const { startDate, actualWorkDays } = req.body || {};
  if (startDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) {
    return res.status(400).json({ error: "startDate must be YYYY-MM-DD or empty" });
  }

  const updates = { startDate };
  // optional owner-or-viewer "how many days do you expect this to take"
  // estimate, entered right after setting a start date — same column the
  // Mark Complete/Final Report flows fill in with the real elapsed days
  // once the job finishes, so this is only ever a placeholder until then
  if (actualWorkDays !== undefined) {
    const parsed = parseWorkDays(actualWorkDays);
    if (!parsed.ok) return res.status(400).json({ error: "actualWorkDays must be a positive number" });
    updates.actualWorkDays = parsed.value;
  }

  const fields = Object.keys(updates);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...updates,
    id: row.id,
  });
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

router.patch("/:id/report", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const { materialCost, laborCost, commission, actualWorkDays, reportTags, markComplete } = req.body || {};
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
  if (reportTags !== undefined) {
    const result = cleanReportTags(reportTags);
    if (!result.ok) return res.status(400).json({ error: result.error });
    patch.reportTags = JSON.stringify(result.value);
  }
  if (markComplete === true) patch.reportCompletedAt = new Date().toISOString();
  if (markComplete === false) patch.reportCompletedAt = null;

  // the report finishes itself once both costs are on file — no separate
  // "mark complete" ritual required. Only kicks in on a normal save
  // (markComplete wasn't explicitly given here) and only ever turns
  // completion on, never off, so an explicit reopen (markComplete: false)
  // always sticks regardless of what's already filled in.
  if (markComplete === undefined && !row.reportCompletedAt) {
    const nextMaterial = "materialCost" in patch ? patch.materialCost : row.materialCost;
    const nextLabor = "laborCost" in patch ? patch.laborCost : row.laborCost;
    if (nextMaterial != null && nextLabor != null) {
      patch.reportCompletedAt = new Date().toISOString();
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "No editable fields given" });
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
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
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
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
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// job profile (instructions, materials ordered, pick-ups on the way,
// special equipment) — viewer-level so the project manager can check things
// off, with the owner-only parts enforced in applyJobDetailsPatch
router.patch("/:id/job-details", requireAuth("viewer"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const validPayeeIds = new Set(parsePayees(row.payees).map((p) => p.id));
  const result = applyJobDetailsPatch(parseJobDetails(row.jobDetails), patch, req.role, validPayeeIds);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  db.prepare(`UPDATE leads SET jobDetails = ? WHERE id = ?`).run(JSON.stringify(result.value), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// estimate basics — the questions answered on every lead before an estimate
// is built (shared/estimateBasics.js). Owner-only; a patch merges into what's
// already saved, so answering one question never clears the others.
router.patch("/:id/estimate-basics", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const next = cleanEstimateBasics({ ...parseEstimateBasics(row.estimateBasics), ...patch });

  db.prepare(`UPDATE leads SET estimateBasics = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

function parseJobtreadLink(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && v.jobId ? { ...v, jobUrl: jobUrl(v.jobId) } : null;
  } catch {
    return null;
  }
}

// Start Estimate — owner-only. Requires the estimate basics, then makes sure
// the lead exists in JobTread as a customer, location and job (reusing a
// customer whose phone/email already matches). Safe to tap again: whatever's
// already linked is reused rather than duplicated. Never sends anything.
const startingEstimate = new Set();
router.post("/:id/start-estimate", requireAuth("owner"), async (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  if (!jobtreadConfigured()) return res.status(503).json({ error: "JobTread isn't connected yet." });

  const basics = parseEstimateBasics(row.estimateBasics);
  const missing = missingEstimateBasics(basics, row.address);
  if (missing.length) {
    return res.status(400).json({ error: `Answer the estimate basics first: ${missing.map((m) => m.label).join(", ")}` });
  }
  if (startingEstimate.has(row.id)) return res.status(409).json({ error: "Already starting this estimate — one moment." });

  startingEstimate.add(row.id);
  let existing = {};
  try {
    existing = row.jobtread ? JSON.parse(row.jobtread) || {} : {};
  } catch {
    existing = {};
  }
  // Sean's answer when a same-name/same-address customer was found
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const choice = {
    useAccountId: typeof body.useAccountId === "string" && /^[A-Za-z0-9]{6,40}$/.test(body.useAccountId) ? body.useAccountId : null,
    createNew: body.createNew === true,
  };
  try {
    const link = await syncLeadToJobTread(row, basics, existing, choice);
    db.prepare(`UPDATE leads SET jobtread = ? WHERE id = ?`).run(JSON.stringify(link), row.id);
    res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
  } catch (err) {
    if (err instanceof PossibleDuplicateError) {
      return res.status(409).json({ error: err.message, duplicates: err.candidates });
    }
    console.error("start-estimate failed", err);
    // keep whatever did get created, so a retry doesn't duplicate it
    if (existing.accountId) db.prepare(`UPDATE leads SET jobtread = ? WHERE id = ?`).run(JSON.stringify(existing), row.id);
    res.status(502).json({ error: `Couldn't reach JobTread: ${err.message}` });
  } finally {
    startingEstimate.delete(row.id);
  }
});

function parseTradeAnswers(raw) {
  if (!raw) return cleanTradeAnswers({});
  try {
    return cleanTradeAnswers(JSON.parse(raw));
  } catch {
    return cleanTradeAnswers({});
  }
}

// trade questionnaire answers — owner-only; merged per trade
router.patch("/:id/trade-answers", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const current = parseTradeAnswers(row.tradeAnswers);
  const merged = {};
  for (const trade of Object.keys(current)) merged[trade] = { ...current[trade], ...(patch[trade] || {}) };
  // a cleared number arrives as "" — drop it rather than keep the old value
  for (const trade of Object.keys(merged)) {
    for (const [k, v] of Object.entries(patch[trade] || {})) if (v === "" || v === null) delete merged[trade][k];
  }
  const next = cleanTradeAnswers(merged);
  db.prepare(`UPDATE leads SET tradeAnswers = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// Build draft estimate — owner-only. Drafts a Proposal on the lead's JobTread
// job from the catalog assemblies and the questionnaire answers. The draft is
// NEVER sent from here; Sean reviews and sends it in JobTread.
const draftingEstimate = new Set();
router.post("/:id/draft-estimate", requireAuth("owner"), async (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  if (!jobtreadConfigured()) return res.status(503).json({ error: "JobTread isn't connected yet." });

  let link = null;
  try {
    link = row.jobtread ? JSON.parse(row.jobtread) : null;
  } catch {
    link = null;
  }
  if (!link?.jobId) return res.status(400).json({ error: "Tap Start Estimate first." });

  const basics = parseEstimateBasics(row.estimateBasics);
  const answers = parseTradeAnswers(row.tradeAnswers);
  const trades = (basics.trades || []).filter((t) => AUTOMATED_TRADES.includes(t));
  if (!trades.length) return res.status(400).json({ error: "None of the work on this lead is automated yet." });
  for (const t of trades) {
    const missing = missingTradeAnswers(t, answers[t], basics);
    if (missing.length) return res.status(400).json({ error: `Still need: ${missing.map((m) => m.label).join(", ")}` });
  }
  if (draftingEstimate.has(row.id)) return res.status(409).json({ error: "Already building this estimate — one moment." });

  draftingEstimate.add(row.id);
  try {
    const { lines, emailMessage, ...draft } = await draftEstimate({ lead: row, basics, answers, link });
    // past pricing + Claude's rule check; flags only, never changes the draft
    draft.review = await reviewDraft({ basics, lines, emailMessage });
    link.estimates = [...(Array.isArray(link.estimates) ? link.estimates : []), draft];
    db.prepare(`UPDATE leads SET jobtread = ? WHERE id = ?`).run(JSON.stringify(link), row.id);
    res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
  } catch (err) {
    console.error("draft-estimate failed", err);
    res.status(502).json({ error: `Couldn't build the estimate: ${err.message}` });
  } finally {
    draftingEstimate.delete(row.id);
  }
});

function linkOf(row) {
  try {
    return row.jobtread ? JSON.parse(row.jobtread) : null;
  } catch {
    return null;
  }
}

function draftedDoc(link, documentId) {
  return (Array.isArray(link?.estimates) ? link.estimates : []).find((e) => e.documentId === documentId);
}

// Send preview — owner-only, read-only: exactly what would go out for this
// drafted proposal (recipient, message, attachments, total) and the
// approval key for it. Pass `emailMessage` to preview an edited message.
router.post("/:id/estimates/:documentId/send-preview", requireAuth("owner"), async (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const link = linkOf(row);
  if (!link?.jobId || !draftedDoc(link, req.params.documentId)) return res.status(404).json({ error: "That proposal wasn't drafted from this lead." });
  try {
    const emailMessage = typeof req.body?.emailMessage === "string" ? req.body.emailMessage.slice(0, 10000) : undefined;
    res.json(await sendPreview(link, req.params.documentId, { emailMessage }));
  } catch (err) {
    if (err instanceof SendRefused) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: `Couldn't reach JobTread: ${err.message}` });
  }
});

// Approve & send — owner-only. The ONLY way Lead Hammer emails a customer,
// and only with the approval key from a preview Sean looked at. Refused if
// anything changed since; afterwards the proposal is set to pending so the
// customer can sign.
const sendingEstimate = new Set();
router.post("/:id/estimates/:documentId/send", requireAuth("owner"), async (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  if (!jobtreadConfigured()) return res.status(503).json({ error: "JobTread isn't connected yet." });
  const link = linkOf(row);
  const entry = draftedDoc(link, req.params.documentId);
  if (!link?.jobId || !entry) return res.status(404).json({ error: "That proposal wasn't drafted from this lead." });
  if (req.body?.approved !== true) return res.status(400).json({ error: "Approve this proposal before sending it." });
  if (sendingEstimate.has(req.params.documentId)) return res.status(409).json({ error: "Already sending — one moment." });
  sendingEstimate.add(req.params.documentId);
  try {
    const emailMessage = typeof req.body?.emailMessage === "string" ? req.body.emailMessage.slice(0, 10000) : undefined;
    const sent = await sendApprovedProposal(link, req.params.documentId, { approvalKey: String(req.body?.approvalKey || ""), emailMessage });
    entry.sent = sent;
    entry.status = sent.status;
    db.prepare(`UPDATE leads SET jobtread = ? WHERE id = ?`).run(JSON.stringify(link), row.id);
    res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
  } catch (err) {
    console.error("send-estimate failed", err);
    if (err instanceof SendRefused) return res.status(err.status).json({ error: err.message });
    // a failure partway through may or may not have emailed: say so plainly
    res.status(502).json({ error: `JobTread error while sending: ${err.message}. Check the proposal in JobTread before trying again.` });
  } finally {
    sendingEstimate.delete(req.params.documentId);
  }
});

// check/uncheck one insurance checklist step — owner-only like the rest of
// the sales side. Checking "jobWon" on a lead still in the insurance bucket
// also moves it to "won" (stamping wonAt), so it carries on through the
// normal board from there.
router.patch("/:id/insurance-checklist", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const { step, done } = req.body || {};
  if (!INSURANCE_STEP_SET.has(step)) return res.status(400).json({ error: "Unknown checklist step" });
  if (typeof done !== "boolean") return res.status(400).json({ error: "done must be true or false" });

  const checklist = parseInsuranceChecklist(row.insuranceChecklist);
  const now = new Date().toISOString();
  if (done) checklist[step] = checklist[step] || now;
  else delete checklist[step];

  const patch = { insuranceChecklist: JSON.stringify(checklist), insurance: 1 };
  const winning = step === "jobWon" && done && row.stage === "insurance";
  if (winning) {
    patch.stage = "won";
    patch.wonAt = now;
    patch.scheduledAt = null;
    patch.paidAt = null;
    patch.lostAt = null;
  }

  const fields = Object.keys(patch);
  db.prepare(`UPDATE leads SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({
    ...patch,
    id: row.id,
  });

  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));

  if (winning) {
    logMove({
      type: "lead",
      entityId: row.id,
      entityName: row.name,
      fromStage: row.stage,
      toStage: "won",
      role: req.role,
    });
  }
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
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// undo an accidental log
router.delete("/:id/followups/:followupId", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;

  const followUps = readFollowUps(row).filter((f) => f.id !== req.params.followupId);

  db.prepare(`UPDATE leads SET followUps = ? WHERE id = ?`).run(JSON.stringify(followUps), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// photos/videos explaining the work — any role can add (the PM may be the
// one on site snapping the "before"), deleting stays owner-only, same split
// as warranty photos
router.post("/:id/media", requireAuth("viewer"), (req, res) => {
  jobMediaUpload.array("media", 10)(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (100MB max)" : "Couldn't upload those files";
      return res.status(400).json({ error: message });
    }

    const row = getLeadOr404(req.params.id, res);
    if (!row) {
      for (const f of req.files || []) fs.unlink(f.path, () => {});
      return;
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No photo or video files given" });

    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO lead_media (id, leadId, filename, kind, createdAt) VALUES (?, ?, ?, ?, ?)`);
    db.transaction((uploaded) => {
      for (const f of uploaded) insert.run(randomUUID(), row.id, f.filename, jobMediaKind(f.filename), now);
    })(files);

    res.status(201).json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
  });
});

router.delete("/:id/media/:mediaId", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const media = db.prepare(`SELECT * FROM lead_media WHERE id = ? AND leadId = ?`).get(req.params.mediaId, row.id);
  if (!media) return res.status(404).json({ error: "File not found" });

  db.prepare(`DELETE FROM lead_media WHERE id = ?`).run(media.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));

  fs.unlink(path.join(JOB_MEDIA_DIR, media.filename), () => {});
});

// full replace of one photo's ruler calibration + measurement lines —
// viewer-level (same as uploading the photo itself) so the PM can measure
// on site, not just the owner
router.put("/:id/media/:mediaId/measure", requireAuth("viewer"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const media = db.prepare(`SELECT * FROM lead_media WHERE id = ? AND leadId = ?`).get(req.params.mediaId, row.id);
  if (!media) return res.status(404).json({ error: "File not found" });

  const result = validateMeasureData(req.body);
  if (!result.ok) return res.status(400).json({ error: result.error });

  db.prepare(`UPDATE lead_media SET measureData = ? WHERE id = ?`).run(JSON.stringify(result.value), media.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// sendFile handles Range requests, which iOS Safari needs to play video
router.get("/media/:filename", requireAuth("viewer"), (req, res) => {
  const { filename } = req.params;
  if (!SAFE_JOB_MEDIA_FILENAME.test(filename)) return res.status(400).end();
  res.sendFile(path.join(JOB_MEDIA_DIR, filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// public share link for a job's instructions + photo/video references —
// owner-only to issue/revoke; a subcontractor with the resulting link never
// needs an app login (see routes/shareView.js, which serves the token side
// unauthenticated)
router.post("/:id/share", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const token = randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO lead_shares (leadId, token, createdAt) VALUES (@leadId, @token, @createdAt)
     ON CONFLICT(leadId) DO UPDATE SET token = excluded.token, createdAt = excluded.createdAt`
  ).run({ leadId: row.id, token, createdAt: new Date().toISOString() });
  res.status(201).json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

router.delete("/:id/share", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  db.prepare(`DELETE FROM lead_shares WHERE leadId = ?`).run(row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// who's owed money on this job (subs and/or the PM) and payments logged
// against them — entirely owner-only, same tier as the other cost fields
router.post("/:id/payees", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const result = validatePayeeInput(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });

  const next = addPayee(parsePayees(row.payees), result.value);
  db.prepare(`UPDATE leads SET payees = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.status(201).json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

router.patch("/:id/payees/:payeeId", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const result = validatePayeeInput(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });

  const next = updatePayee(parsePayees(row.payees), req.params.payeeId, result.value);
  if (!next) return res.status(404).json({ error: "Payee not found" });
  db.prepare(`UPDATE leads SET payees = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

router.delete("/:id/payees/:payeeId", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const next = removePayee(parsePayees(row.payees), req.params.payeeId);
  db.prepare(`UPDATE leads SET payees = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

router.post("/:id/payees/:payeeId/payments", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const result = validatePaymentInput(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });

  const next = addPayment(parsePayees(row.payees), req.params.payeeId, result.value);
  if (!next) return res.status(404).json({ error: "Payee not found" });
  db.prepare(`UPDATE leads SET payees = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.status(201).json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

router.delete("/:id/payees/:payeeId/payments/:paymentId", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const next = removePayment(parsePayees(row.payees), req.params.payeeId, req.params.paymentId);
  if (!next) return res.status(404).json({ error: "Payee not found" });
  db.prepare(`UPDATE leads SET payees = ? WHERE id = ?`).run(JSON.stringify(next), row.id);
  res.json(forRole(req.role, rowToLead(db.prepare(`SELECT * FROM leads WHERE id = ?`).get(row.id))));
});

// a one-page PDF with just what this sub/PM needs: customer, address, their
// agreed amount, their own instructions, and every job reference photo —
// nothing about other payees or other jobs
router.get("/:id/payees/:payeeId/pdf", requireAuth("owner"), async (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const payee = parsePayees(row.payees).find((p) => p.id === req.params.payeeId);
  if (!payee) return res.status(404).json({ error: "Payee not found" });

  try {
    const pdf = await buildPayeePdf({ lead: row, payee, media: mediaFor(row.id), jobDetails: parseJobDetails(row.jobDetails) });
    const safeName = (payee.name || "sub").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "sub";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-job-info.pdf"`);
    res.send(pdf);
  } catch {
    res.status(500).json({ error: "Couldn't generate the PDF — try again" });
  }
});

router.delete("/:id", requireAuth("owner"), (req, res) => {
  const row = getLeadOr404(req.params.id, res);
  if (!row) return;
  const media = db.prepare(`SELECT filename FROM lead_media WHERE leadId = ?`).all(row.id);
  db.prepare(`DELETE FROM lead_media WHERE leadId = ?`).run(row.id);
  db.prepare(`DELETE FROM lead_shares WHERE leadId = ?`).run(row.id);
  db.prepare(`DELETE FROM leads WHERE id = ?`).run(row.id);
  deleteMeasureDataForLead(row.id);
  res.status(204).end();

  for (const m of media) fs.unlink(path.join(JOB_MEDIA_DIR, m.filename), () => {});
});

export default router;
