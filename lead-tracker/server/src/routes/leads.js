import { Router } from "express";
import { randomUUID } from "node:crypto";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { sendDueReportReminders } from "../reportReminders.js";
import { sendPushToUser, sendPushToTenantAdmins } from "../pushService.js";
import { logMove } from "../activityLog.js";
import { upsertContactFromLead, updateContact } from "../contacts.js";
import { localMonthKey } from "../businessTime.js";

const router = Router();

const SOURCES = new Set(["referral", "referral_bni", "google", "facebook", "website", "other"]);
const STAGES = new Set(["new", "bid", "lost", "won", "progress", "completed", "paid"]);
const EDITABLE_FIELDS = new Set([
  "createdAt", "startDate", "completedAt", "revenue", "name", "job", "phone", "email",
  "address", "source", "sourceOther", "appointmentAt", "actualWorkDays",
]);

function parseWorkDays(value) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

// camelCase field name -> snake_case column name, for the general PATCH /:id route.
const FIELD_COLUMN = {
  createdAt: "created_at", startDate: "start_date", completedAt: "completed_at",
  revenue: "revenue", name: "name", job: "job", phone: "phone", email: "email",
  address: "address", source: "source", sourceOther: "source_other",
  appointmentAt: "appointment_at", actualWorkDays: "actual_work_days",
};

function rowToLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assignedPmId: row.assigned_pm_id,
    contactId: row.contact_id,
    name: row.name,
    stage: row.stage,
    createdAt: row.created_at,
    startDate: row.start_date,
    revenue: row.revenue === null ? null : Number(row.revenue),
    wonAt: row.won_at,
    paidAt: row.paid_at,
    source: row.source,
    sourceOther: row.source_other,
    archived: row.archived,
    archivedAt: row.archived_at,
    job: row.job,
    phone: row.phone,
    email: row.email,
    address: row.address,
    bidSentAt: row.bid_sent_at,
    completedAt: row.completed_at,
    materialCost: row.material_cost === null ? null : Number(row.material_cost),
    laborCost: row.labor_cost === null ? null : Number(row.labor_cost),
    commission: row.commission === null ? null : Number(row.commission),
    reportCompletedAt: row.report_completed_at,
    lastReportReminderAt: row.last_report_reminder_at,
    wentWell: row.went_well,
    wentWrong: row.went_wrong,
    actualWorkDays: row.actual_work_days === null ? null : Number(row.actual_work_days),
    appointmentAt: row.appointment_at,
    appointmentReminderSentAt: row.appointment_reminder_sent_at,
    lostAt: row.lost_at,
    scopeOfWork: row.scope_of_work || [],
    followUps: row.follow_ups || [],
  };
}

// A PM only ever sees/acts on jobs assigned to them; a tenant admin sees everything in
// their tenant. This is the "PM's own book of business" boundary the whole route file
// enforces on top of the tenant_id scoping withTenant() already gives for free.
function canAccessLead(effective, row) {
  return effective.role === "tenant_admin" || row.assigned_pm_id === effective.userId;
}

// Shared by the authenticated create route and the public website-intake route.
// assignedPmId is null unless a PM is creating their own lead (they own what they sell).
export async function insertLead(client, tenantId, { name, job, phone, email, source, sourceOther, assignedPmId }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const cleanName = String(name).trim();
  const cleanPhone = String(phone || "").trim();
  const cleanEmail = String(email || "").trim();
  const cleanJob = String(job || "").trim();
  const cleanSourceOther = source === "other" || source === "website" ? String(sourceOther || "").trim() : "";

  const contactId = await upsertContactFromLead(
    client,
    tenantId,
    { name: cleanName, phone: cleanPhone, email: cleanEmail, address: "" },
    { isNewLead: true }
  );

  const { rows } = await client.query(
    `INSERT INTO leads (id, tenant_id, assigned_pm_id, contact_id, name, job, phone, email, address, stage, created_at, source, source_other)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', 'new', $9, $10, $11) RETURNING *`,
    [id, tenantId, assignedPmId || null, contactId, cleanName, cleanJob, cleanPhone, cleanEmail, createdAt, source, cleanSourceOther]
  );
  return rows[0];
}

export { SOURCES };

// Mirrors the old client-side sweep: paid leads roll into the archive once the calendar
// month they were paid in has passed, in tenant-local time.
async function sweepArchive(client, timezone) {
  const thisMonth = localMonthKey(new Date(), timezone);
  const { rows } = await client.query(
    `SELECT id, paid_at FROM leads WHERE stage = 'paid' AND archived = false AND paid_at IS NOT NULL`
  );
  const toSweep = rows.filter((row) => localMonthKey(new Date(row.paid_at), timezone) !== thisMonth);
  if (!toSweep.length) return;
  const now = new Date().toISOString();
  for (const row of toSweep) {
    await client.query(`UPDATE leads SET archived = true, archived_at = $2 WHERE id = $1`, [row.id, now]);
  }
}

async function getLead(client, id) {
  const { rows } = await client.query(`SELECT * FROM leads WHERE id = $1`, [id]);
  return rows[0] || null;
}

router.get("/", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const { rows: tenantRows } = await client.query(`SELECT timezone FROM tenants WHERE id = $1`, [effective.tenantId]);
      await sweepArchive(client, tenantRows[0]?.timezone);
      const { rows } =
        effective.role === "tenant_admin"
          ? await client.query(`SELECT * FROM leads ORDER BY created_at DESC`)
          : await client.query(
              `SELECT * FROM leads WHERE assigned_pm_id = $1 ORDER BY created_at DESC`,
              [effective.userId]
            );
      const leads = rows.map(rowToLead);
      // profit is admin-only: strip the cost inputs at the API layer too, not just in
      // the UI, so a PM can't recover them by inspecting the response.
      if (effective.role !== "tenant_admin") {
        for (const lead of leads) {
          lead.materialCost = null;
          lead.laborCost = null;
          lead.commission = null;
        }
      }
      res.json(leads);
    });
  } catch (err) {
    next(err);
  }
});

// Both a tenant admin and a PM can sell/create a job -- a PM-created lead is
// auto-assigned to that PM (they own what they sell); a tenant-admin-created lead is
// unassigned until pushed to a PM via POST /:id/assign.
router.post("/", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { name, job, phone, email, source, sourceOther } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Name is required" });
    if (!source || !SOURCES.has(source)) return res.status(400).json({ error: "Valid source is required" });

    const assignedPmId = req.effective.role === "pm" ? req.effective.userId : null;
    const row = await withTenant(req.effective.tenantId, (client) =>
      insertLead(client, req.effective.tenantId, { name, job, phone, email, source, sourceOther, assignedPmId })
    );
    res.status(201).json(rowToLead(row));
  } catch (err) {
    next(err);
  }
});

const AT_OR_AFTER_BID = new Set(["bid", "lost", "won", "progress", "completed", "paid"]);
const AT_OR_AFTER_WON = new Set(["won", "progress", "completed", "paid"]);
const AT_OR_AFTER_COMPLETED = new Set(["completed", "paid"]);

// PM-level so a project manager can advance their own job from "in progress" to
// "completed" -- this IS the "push a completed job to the admin for payment" workflow.
// Every other transition (including reverts) stays tenant-admin-only.
router.post("/:id/move", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    const { stage, date, revert, workDays } = req.body || {};
    if (!STAGES.has(stage)) return res.status(400).json({ error: "Invalid stage" });

    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      if (!canAccessLead(effective, row)) return res.status(403).json({ error: "Not your job" });

      if (effective.role !== "tenant_admin") {
        const pmAllowed = !revert && row.stage === "progress" && stage === "completed";
        if (!pmAllowed) return res.status(403).json({ error: "Admin access required" });
      }

      let ts = new Date().toISOString();
      if (date) {
        const parsed = new Date(`${date}T00:00:00.000Z`);
        if (isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid date" });
        ts = parsed.toISOString();
      }

      const patch = { stage };
      if (stage !== "lost") patch.lostAt = null;
      if (revert) {
        if (!AT_OR_AFTER_BID.has(stage)) patch.bidSentAt = null;
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
        patch.wonAt = null;
        patch.paidAt = null;
        patch.completedAt = null;
        patch.actualWorkDays = null;
        patch.lostAt = ts;
      } else {
        patch.wonAt = null;
        patch.paidAt = null;
        patch.bidSentAt = null;
      }

      await applyLeadPatch(client, row.id, patch);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));

      await logMove({
        tenantId: effective.tenantId,
        type: "lead",
        entityId: row.id,
        entityName: row.name,
        fromStage: row.stage,
        toStage: stage,
        actorUserId: effective.userId,
      });

      if (!revert && stage === "completed") {
        // a job just landed in "completed" -- tell the tenant admin it's ready to be
        // reviewed/pushed toward payment, and kick the report-reminder sweep now
        // instead of waiting for the next hourly pass.
        sendPushToTenantAdmins(effective.tenantId, {
          title: "Job completed",
          body: `${row.name} was marked complete and is ready for your final report/payment review.`,
          leadId: row.id,
        }).catch((err) => console.error("completed push notify failed:", err.message));
        sendDueReportReminders(effective.tenantId).catch((err) =>
          console.error("report reminder sweep failed:", err.message)
        );
      }
    });
  } catch (err) {
    next(err);
  }
});

// snake_case column names for the fields applyLeadPatch may receive, keyed by the
// camelCase patch keys used throughout this file.
const PATCH_COLUMN = {
  stage: "stage", lostAt: "lost_at", bidSentAt: "bid_sent_at", wonAt: "won_at",
  paidAt: "paid_at", completedAt: "completed_at", actualWorkDays: "actual_work_days",
};

async function applyLeadPatch(client, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const setClauses = keys.map((k, i) => `${PATCH_COLUMN[k] || FIELD_COLUMN[k] || k} = $${i + 2}`);
  await client.query(`UPDATE leads SET ${setClauses.join(", ")} WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

// Tenant-admin-only: push a job to a PM, retrieve it back (pmId: null), or reassign it
// to a different PM. This is the "push jobs to them" / "retrieve jobs and reassign"
// workflow from the admin side.
router.post("/:id/assign", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    const { pmId } = req.body || {};
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });

      if (pmId) {
        const { rows } = await client.query(
          `SELECT id, name FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'pm' AND disabled_at IS NULL`,
          [pmId, effective.tenantId]
        );
        if (!rows.length) return res.status(400).json({ error: "PM not found in this tenant" });
      }

      await client.query(`UPDATE leads SET assigned_pm_id = $2 WHERE id = $1`, [row.id, pmId || null]);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));

      await logMove({
        tenantId: effective.tenantId,
        type: "assignment",
        entityId: row.id,
        entityName: row.name,
        fromStage: row.assigned_pm_id,
        toStage: pmId || "unassigned",
        actorUserId: effective.userId,
      });

      if (pmId) {
        sendPushToUser(effective.tenantId, pmId, {
          title: "Job assigned to you",
          body: `${row.name} has been assigned to you. Contact the customer and schedule the work.`,
          leadId: row.id,
        }).catch((err) => console.error("assign push notify failed:", err.message));
      }
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });

      const updates = {};
      for (const [key, value] of Object.entries(req.body || {})) {
        if (EDITABLE_FIELDS.has(key)) updates[key] = value;
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No editable fields given" });
      if ("name" in updates) {
        updates.name = String(updates.name).trim();
        if (!updates.name) return res.status(400).json({ error: "Name can't be empty" });
      }
      if ("job" in updates) updates.job = String(updates.job || "").trim();
      if ("source" in updates && !SOURCES.has(updates.source)) {
        return res.status(400).json({ error: "Invalid source" });
      }
      if ("sourceOther" in updates) updates.sourceOther = String(updates.sourceOther || "").trim();
      if ("appointmentAt" in updates) {
        updates.appointmentAt = updates.appointmentAt || null;
        updates.appointmentReminderSentAt = null;
      }
      if ("actualWorkDays" in updates) {
        const parsed = parseWorkDays(updates.actualWorkDays);
        if (!parsed.ok) return res.status(400).json({ error: "actualWorkDays must be a positive number" });
        updates.actualWorkDays = parsed.value;
      }

      await applyLeadPatch(client, row.id, updates);

      if (["name", "phone", "email", "address"].some((f) => f in updates)) {
        const merged = { ...row, ...updates };
        const contactInfo = { name: merged.name, phone: merged.phone, email: merged.email, address: merged.address };
        if (row.contact_id) {
          await updateContact(client, effective.tenantId, row.contact_id, contactInfo);
        } else {
          const contactId = await upsertContactFromLead(client, effective.tenantId, contactInfo, { isNewLead: false });
          await client.query(`UPDATE leads SET contact_id = $2 WHERE id = $1`, [row.id, contactId]);
        }
      }

      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

// PM-level so a project manager can schedule/reschedule their own won job's start date
// without needing admin access -- restricted to jobs that have actually been won.
router.patch("/:id/start-date", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      if (!canAccessLead(effective, row)) return res.status(403).json({ error: "Not your job" });
      if (!AT_OR_AFTER_WON.has(row.stage)) {
        return res.status(403).json({ error: "Start date can only be set on a won job" });
      }

      const { startDate, actualWorkDays } = req.body || {};
      if (startDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) {
        return res.status(400).json({ error: "startDate must be YYYY-MM-DD or empty" });
      }
      const updates = { startDate: startDate || null };
      if (actualWorkDays !== undefined) {
        const parsed = parseWorkDays(actualWorkDays);
        if (!parsed.ok) return res.status(400).json({ error: "actualWorkDays must be a positive number" });
        updates.actualWorkDays = parsed.value;
      }

      await applyLeadPatch(client, row.id, updates);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/report", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });

      const { materialCost, laborCost, commission, actualWorkDays, wentWell, wentWrong, markComplete } = req.body || {};
      const patch = {};
      const num = (v) => (v === null || v === "" ? null : Number(v));
      if (materialCost !== undefined) patch.material_cost = num(materialCost);
      if (laborCost !== undefined) patch.labor_cost = num(laborCost);
      if (commission !== undefined) patch.commission = num(commission);
      if (actualWorkDays !== undefined) patch.actual_work_days = num(actualWorkDays);
      if (wentWell !== undefined) patch.went_well = String(wentWell || "").trim();
      if (wentWrong !== undefined) patch.went_wrong = String(wentWrong || "").trim();
      if (markComplete === true) patch.report_completed_at = new Date().toISOString();
      if (markComplete === false) patch.report_completed_at = null;

      const keys = Object.keys(patch);
      if (!keys.length) return res.status(400).json({ error: "No editable fields given" });
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
      await client.query(`UPDATE leads SET ${setClauses.join(", ")} WHERE id = $1`, [row.id, ...keys.map((k) => patch[k])]);

      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

// Full replace of the scope-of-work checklist -- tenant-admin-only.
router.put("/:id/scope-of-work", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ error: "items array is required" });
    const cleaned = [];
    for (const item of items) {
      const text = String(item?.text || "").trim();
      if (!text) continue;
      cleaned.push({ id: typeof item?.id === "string" && item.id ? item.id : randomUUID(), text, done: !!item?.done });
    }

    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      await client.query(`UPDATE leads SET scope_of_work = $2 WHERE id = $1`, [row.id, JSON.stringify(cleaned)]);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

// Toggling a single item -- PM-level (their own job) so the crew can check items off.
router.patch("/:id/scope-of-work", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    const { itemId, done } = req.body || {};
    if (!itemId) return res.status(400).json({ error: "itemId is required" });

    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      if (!canAccessLead(effective, row)) return res.status(403).json({ error: "Not your job" });

      const items = row.scope_of_work || [];
      const item = items.find((i) => i.id === itemId);
      if (!item) return res.status(404).json({ error: "Checklist item not found" });
      item.done = !!done;

      await client.query(`UPDATE leads SET scope_of_work = $2 WHERE id = $1`, [row.id, JSON.stringify(items)]);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

// Logging a follow-up touch -- tenant admin (any job) or a PM on their own job, since
// PMs sell and manage their own leads too.
router.post("/:id/followups", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      if (!canAccessLead(effective, row)) return res.status(403).json({ error: "Not your job" });

      const followUps = row.follow_ups || [];
      followUps.push({ id: randomUUID(), createdAt: new Date().toISOString() });
      await client.query(`UPDATE leads SET follow_ups = $2 WHERE id = $1`, [row.id, JSON.stringify(followUps)]);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/followups/:followupId", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      if (!canAccessLead(effective, row)) return res.status(403).json({ error: "Not your job" });

      const followUps = (row.follow_ups || []).filter((f) => f.id !== req.params.followupId);
      await client.query(`UPDATE leads SET follow_ups = $2 WHERE id = $1`, [row.id, JSON.stringify(followUps)]);
      const updated = await getLead(client, row.id);
      res.json(rowToLead(updated));
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const row = await getLead(client, req.params.id);
      if (!row) return res.status(404).json({ error: "Lead not found" });
      await client.query(`DELETE FROM leads WHERE id = $1`, [row.id]);
      res.status(204).end();
    });
  } catch (err) {
    next(err);
  }
});

export default router;
