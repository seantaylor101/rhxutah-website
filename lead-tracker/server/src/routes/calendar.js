import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getOrCreateCalendarFeedToken } from "./settings.js";
import { buildEvent, buildCalendar } from "../ics.js";

const router = Router();

// single-event download for one lead's appointment — authenticated, uses the
// normal session cookie since it's fetched from inside the app
router.get("/leads/:id.ics", requireAuth("viewer"), (req, res) => {
  const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(req.params.id);
  if (!lead || !lead.appointmentAt) return res.status(404).json({ error: "No appointment set" });

  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lead Hammer//Appointments//EN", buildEvent(lead), "END:VCALENDAR"].join(
    "\r\n"
  );
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="appointment-${lead.id}.ics"`);
  res.send(ics);
});

// subscribable feed of every upcoming appointment — deliberately NOT behind
// requireAuth: Apple Calendar's own fetcher polls this URL directly and has
// no way to carry the app's session cookie, so it's gated by an opaque token
// instead (see getOrCreateCalendarFeedToken)
router.get("/feed/:token.ics", (req, res) => {
  const token = getOrCreateCalendarFeedToken();
  if (req.params.token !== token) return res.status(404).end();

  const leads = db
    .prepare(`SELECT * FROM leads WHERE appointmentAt IS NOT NULL AND archived = 0 ORDER BY appointmentAt ASC`)
    .all();
  const ics = buildCalendar(leads, { name: "Lead Hammer Appointments" });
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.send(ics);
});

export default router;
