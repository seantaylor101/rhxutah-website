import { Router } from "express";
import { withTenant, withPlatform } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { getOrCreateCalendarFeedToken } from "./settings.js";
import { buildEvent, buildCalendar } from "../ics.js";

const router = Router();

function toLeadIcsShape(row) {
  return { id: row.id, name: row.name, job: row.job, phone: row.phone, email: row.email, appointmentAt: row.appointment_at };
}

router.get("/leads/:id.ics", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { effective } = req;
    await withTenant(effective.tenantId, async (client) => {
      const { rows } = await client.query(`SELECT * FROM leads WHERE id = $1`, [req.params.id]);
      const lead = rows[0];
      if (!lead || !lead.appointment_at) return res.status(404).json({ error: "No appointment set" });
      if (effective.role === "pm" && lead.assigned_pm_id !== effective.userId) {
        return res.status(404).json({ error: "No appointment set" });
      }

      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Lead Hammer//Appointments//EN",
        buildEvent(toLeadIcsShape(lead)),
        "END:VCALENDAR",
      ].join("\r\n");
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="appointment-${lead.id}.ics"`);
      res.send(ics);
    });
  } catch (err) {
    next(err);
  }
});

// Subscribable feed of every upcoming appointment for one tenant -- deliberately NOT
// behind requireAuth: Apple Calendar's own fetcher polls this URL directly and can't
// carry the app's session cookie, so it's gated by an opaque per-tenant token instead.
// calendar_feed_tokens is the one business-adjacent table leadhammer_platform can read
// unconditionally (see 0003_calendar_feed_tokens.sql) specifically so this token ->
// tenant_id resolution can happen before any tenant context exists.
router.get("/feed/:token.ics", async (req, res, next) => {
  try {
    const { rows } = await withPlatform((client) =>
      client.query(`SELECT tenant_id FROM calendar_feed_tokens WHERE token = $1`, [req.params.token])
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) return res.status(404).end();

    await withTenant(tenantId, async (client) => {
      const { rows: leads } = await client.query(
        `SELECT * FROM leads WHERE appointment_at IS NOT NULL AND archived = false ORDER BY appointment_at ASC`
      );
      const ics = buildCalendar(leads.map(toLeadIcsShape), { name: "Lead Hammer Appointments" });
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.send(ics);
    });
  } catch (err) {
    next(err);
  }
});

export default router;
