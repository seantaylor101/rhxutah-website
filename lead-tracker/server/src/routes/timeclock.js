import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { addDays, hoursForPeriod, periodStartFor, isDateKey, normalizePeriodStart } from "../payroll.js";

// Employee-only: an employee login can reach these and nothing else.
const router = Router();
router.use(requireAuth("employee"));

const MAX_SHIFT_HOURS = 24;
const HISTORY_WEEKS = 12;

function openEntry(employeeId) {
  return db
    .prepare(`SELECT * FROM time_entries WHERE employeeId = ? AND clockOut IS NULL AND status = 'approved' ORDER BY clockIn DESC LIMIT 1`)
    .get(employeeId);
}

function cleanPoint(p, kind) {
  if (!p || typeof p !== "object") return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const accuracy = Number(p.accuracy);
  const ts = p.ts && !Number.isNaN(Date.parse(p.ts)) ? new Date(p.ts).toISOString() : new Date().toISOString();
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, ts, kind };
}

const insertPoint = db.prepare(
  `INSERT INTO gps_points (employeeId, timeEntryId, ts, lat, lng, accuracy, kind) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

function savePoint(employeeId, entryId, point) {
  if (point) insertPoint.run(employeeId, entryId, point.ts, point.lat, point.lng, point.accuracy, point.kind);
}

function overlaps(employeeId, startIso, endIso, exceptId = "") {
  return db
    .prepare(
      `SELECT id FROM time_entries
        WHERE employeeId = ? AND id != ? AND clockIn < ? AND COALESCE(clockOut, ?) > ? LIMIT 1`
    )
    .get(employeeId, exceptId, endIso, new Date().toISOString(), startIso);
}

function parseTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}

function status(employee) {
  const periodStart = periodStartFor();
  return {
    employee: { id: employee.id, name: employee.name },
    open: openEntry(employee.id) || null,
    week: hoursForPeriod(employee.id, periodStart),
  };
}

router.get("/status", (req, res) => {
  res.json(status(req.employee));
});

router.post("/clock-in", (req, res) => {
  const emp = req.employee;
  if (openEntry(emp.id)) return res.status(409).json({ error: "You're already clocked in" });
  const now = new Date();
  const nowIso = now.toISOString();
  if (overlaps(emp.id, nowIso, nowIso)) return res.status(409).json({ error: "That overlaps a shift already on your timesheet" });

  // "I actually started earlier" — the time between then and now goes in
  // as its own request for the owner to approve; the live shift starts now
  let startedEarlier = null;
  if (req.body?.startedAt) {
    startedEarlier = parseTime(req.body.startedAt);
    if (!startedEarlier) return res.status(400).json({ error: "Couldn't read that start time" });
    if (startedEarlier >= now) return res.status(400).json({ error: "The start time has to be earlier than now" });
    if (now - startedEarlier > MAX_SHIFT_HOURS * 3600000) return res.status(400).json({ error: "That's more than a day ago — add it as a missed shift instead" });
    if (overlaps(emp.id, startedEarlier.toISOString(), nowIso)) return res.status(409).json({ error: "That start time overlaps a shift already on your timesheet" });
  }

  const id = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO time_entries (id, employeeId, clockIn, source, status, note, createdAt) VALUES (?, ?, ?, 'app', 'approved', '', ?)`
    ).run(id, emp.id, nowIso, nowIso);
    savePoint(emp.id, id, cleanPoint(req.body?.location, "in"));
    if (startedEarlier) {
      db.prepare(
        `INSERT INTO time_entries (id, employeeId, clockIn, clockOut, source, status, note, createdAt)
         VALUES (?, ?, ?, ?, 'request', 'pending', ?, ?)`
      ).run(randomUUID(), emp.id, startedEarlier.toISOString(), nowIso, String(req.body?.note || "Forgot to clock in").slice(0, 500), nowIso);
    }
  })();
  res.json(status(emp));
});

router.post("/clock-out", (req, res) => {
  const emp = req.employee;
  const entry = openEntry(emp.id);
  if (!entry) return res.status(409).json({ error: "You're not clocked in" });
  const now = new Date();

  // "I forgot to clock out — I actually stopped at …": only ever earlier
  // than now (fewer hours), so it applies right away; it's marked so the
  // owner can see it was entered after the fact
  let out = now;
  let note = entry.note;
  let source = entry.source;
  if (req.body?.stoppedAt) {
    const stopped = parseTime(req.body.stoppedAt);
    if (!stopped) return res.status(400).json({ error: "Couldn't read that time" });
    if (stopped > now) return res.status(400).json({ error: "The stop time can't be in the future" });
    if (stopped <= new Date(entry.clockIn)) return res.status(400).json({ error: "The stop time has to be after you clocked in" });
    out = stopped;
    source = "request";
    note = [note, `Clocked out after the fact (tapped at ${now.toISOString()})`].filter(Boolean).join(" · ").slice(0, 500);
  } else if (now - new Date(entry.clockIn) > MAX_SHIFT_HOURS * 3600000) {
    return res.status(400).json({ error: "This shift is over 24 hours — enter the time you actually stopped" });
  }

  db.transaction(() => {
    db.prepare(`UPDATE time_entries SET clockOut = ?, source = ?, note = ?, updatedAt = ? WHERE id = ?`).run(
      out.toISOString(),
      source,
      note,
      now.toISOString(),
      entry.id
    );
    savePoint(emp.id, entry.id, cleanPoint(req.body?.location, "out"));
  })();
  res.json(status(emp));
});

// GPS while on the clock. Each fix is filed under the shift it falls in;
// anything taken while he was off the clock is thrown away — this is never
// used to follow someone outside paid time.
router.post("/gps", (req, res) => {
  const emp = req.employee;
  const points = Array.isArray(req.body?.points) ? req.body.points.slice(0, 500) : [];
  const shifts = db
    .prepare(
      `SELECT id, clockIn, clockOut FROM time_entries
        WHERE employeeId = ? AND status = 'approved' AND clockIn > ? ORDER BY clockIn`
    )
    .all(emp.id, new Date(Date.now() - 3 * 86400000).toISOString());
  let saved = 0;
  db.transaction(() => {
    for (const raw of points) {
      const p = cleanPoint(raw, "track");
      if (!p) continue;
      const t = new Date(p.ts);
      const shift = shifts.find((s) => new Date(s.clockIn) <= t && (!s.clockOut || t <= new Date(s.clockOut)));
      if (!shift) continue;
      savePoint(emp.id, shift.id, p);
      saved++;
    }
  })();
  res.json({ saved });
});

// whole missed shift — goes to the owner as a request
router.post("/requests", (req, res) => {
  const emp = req.employee;
  const start = parseTime(req.body?.clockIn);
  const end = parseTime(req.body?.clockOut);
  const note = String(req.body?.note || "").trim().slice(0, 500);
  if (!start || !end) return res.status(400).json({ error: "Enter both a start and end time" });
  if (end <= start) return res.status(400).json({ error: "End time has to be after the start time" });
  if (end > new Date()) return res.status(400).json({ error: "End time can't be in the future" });
  if (end - start > MAX_SHIFT_HOURS * 3600000) return res.status(400).json({ error: "A shift can't be longer than 24 hours" });
  if (!note) return res.status(400).json({ error: "Add a quick note (which job, what happened)" });
  if (overlaps(emp.id, start.toISOString(), end.toISOString())) {
    return res.status(409).json({ error: "That overlaps a shift already on your timesheet" });
  }
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO time_entries (id, employeeId, clockIn, clockOut, source, status, note, createdAt)
     VALUES (?, ?, ?, ?, 'request', 'pending', ?, ?)`
  ).run(randomUUID(), emp.id, start.toISOString(), end.toISOString(), note, nowIso);
  res.json(status(emp));
});

// he can take back a request the owner hasn't acted on yet
router.delete("/requests/:id", (req, res) => {
  const r = db
    .prepare(`DELETE FROM time_entries WHERE id = ? AND employeeId = ? AND status = 'pending'`)
    .run(req.params.id, req.employee.id);
  if (!r.changes) return res.status(404).json({ error: "Request not found" });
  res.json(status(req.employee));
});

// hours history, newest week first. Hours only — no pay figures.
router.get("/history", (req, res) => {
  const emp = req.employee;
  const before = isDateKey(req.query.before) ? normalizePeriodStart(req.query.before) : addDays(periodStartFor(), 7);
  const weeks = [];
  for (let i = 1; i <= HISTORY_WEEKS; i++) {
    const week = hoursForPeriod(emp.id, addDays(before, -7 * i));
    week.entries = week.entries.map(({ id, clockIn, clockOut, source, status: st, note, hours, localDate }) => ({
      id,
      clockIn,
      clockOut,
      source,
      status: st,
      note,
      hours,
      localDate,
    }));
    weeks.push(week);
  }
  const oldest = db.prepare(`SELECT MIN(clockIn) AS t FROM time_entries WHERE employeeId = ?`).get(emp.id)?.t;
  const nextBefore = addDays(before, -7 * HISTORY_WEEKS);
  res.json({ weeks, nextBefore: oldest && new Date(oldest) < new Date(`${nextBefore}T12:00:00Z`) ? nextBefore : null });
});

export default router;
