import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  createEmployee,
  getEmployee,
  listEmployees,
  passcodeProblem,
  hashPasscode,
  publicEmployee,
} from "../employees.js";
import {
  getPayrollSettings,
  savePayrollSettings,
  buildReport,
  buildPayrollEmail,
  periodStartFor,
  normalizePeriodStart,
  isDateKey,
  addDays,
  hoursForPeriod,
  periodLabel,
} from "../payroll.js";
import { googleConfigured } from "../measure/google.js";

// Owner only — the employee's own screen never sees rates, piece rate or pay.
const router = Router();
router.use(requireAuth("owner"));

const MAX_SHIFT_HOURS = 24;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function employeeOr404(id, res) {
  const emp = getEmployee(id);
  if (!emp) res.status(404).json({ error: "Employee not found" });
  return emp;
}

function entryOr404(id, res) {
  const entry = db.prepare(`SELECT * FROM time_entries WHERE id = ?`).get(id);
  if (!entry) res.status(404).json({ error: "Time entry not found" });
  return entry;
}

function parseRate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
}

function periodFrom(value) {
  return isDateKey(value) ? normalizePeriodStart(value) : periodStartFor();
}

function overlaps(employeeId, startIso, endIso, exceptId = "") {
  return db
    .prepare(
      `SELECT id FROM time_entries
        WHERE employeeId = ? AND id != ? AND clockIn < ? AND COALESCE(clockOut, ?) > ? LIMIT 1`
    )
    .get(employeeId, exceptId, endIso, new Date().toISOString(), startIso);
}

// start required; end optional (null = still on the clock)
function validateShift(body, { allowOpen = false } = {}) {
  const start = body.clockIn && !Number.isNaN(Date.parse(body.clockIn)) ? new Date(body.clockIn) : null;
  if (!start) return { error: "Enter a start time" };
  let end = null;
  if (body.clockOut) {
    if (Number.isNaN(Date.parse(body.clockOut))) return { error: "Couldn't read the end time" };
    end = new Date(body.clockOut);
  } else if (!allowOpen) {
    return { error: "Enter an end time" };
  }
  const now = new Date();
  if (start > now) return { error: "Start time can't be in the future" };
  if (end && end <= start) return { error: "End time has to be after the start time" };
  if (end && end > now) return { error: "End time can't be in the future" };
  if ((end || now) - start > MAX_SHIFT_HOURS * 3600000) return { error: "A shift can't be longer than 24 hours" };
  return { start, end };
}

// ── settings ────────────────────────────────────────────────────────────
router.get("/settings", (req, res) => {
  res.json({ ...getPayrollSettings(), mapsEnabled: googleConfigured() });
});

router.patch("/settings", (req, res) => {
  const patch = {};
  if (req.body?.payrollEmail !== undefined) {
    const email = String(req.body.payrollEmail).trim();
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address doesn't look right" });
    patch.payrollEmail = email;
  }
  if (req.body?.weekStartDay !== undefined) {
    const d = Number(req.body.weekStartDay);
    if (!Number.isInteger(d) || d < 0 || d > 6) return res.status(400).json({ error: "Pick a day of the week" });
    patch.weekStartDay = d;
  }
  res.json({ ...savePayrollSettings(patch), mapsEnabled: googleConfigured() });
});

// ── employees ───────────────────────────────────────────────────────────
router.get("/employees", (req, res) => {
  const periodStart = periodStartFor();
  const pending = db.prepare(`SELECT employeeId, COUNT(*) AS c FROM time_entries WHERE status = 'pending' GROUP BY employeeId`).all();
  const pendingBy = new Map(pending.map((p) => [p.employeeId, p.c]));
  const employees = listEmployees().map((e) => {
    const week = hoursForPeriod(e.id, periodStart);
    return {
      ...e,
      weekHours: week.totalHours,
      clockedIn: !!db.prepare(`SELECT 1 FROM time_entries WHERE employeeId = ? AND clockOut IS NULL AND status = 'approved'`).get(e.id),
      pendingRequests: pendingBy.get(e.id) || 0,
    };
  });
  res.json({ employees, currentPeriodStart: periodStart, currentPeriodLabel: periodLabel(periodStart) });
});

router.post("/employees", (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const passcode = String(req.body?.passcode || "");
  const hourlyRate = parseRate(req.body?.hourlyRate);
  if (!name) return res.status(400).json({ error: "Enter a name" });
  if (hourlyRate === null) return res.status(400).json({ error: "Enter an hourly rate" });
  const problem = passcodeProblem(passcode);
  if (problem) return res.status(400).json({ error: problem });
  res.status(201).json(createEmployee({ name, passcode, hourlyRate }));
});

router.patch("/employees/:id", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  const next = { ...emp };
  if (req.body?.name !== undefined) {
    next.name = String(req.body.name).trim().slice(0, 80);
    if (!next.name) return res.status(400).json({ error: "Enter a name" });
  }
  if (req.body?.hourlyRate !== undefined) {
    next.hourlyRate = parseRate(req.body.hourlyRate);
    if (next.hourlyRate === null) return res.status(400).json({ error: "Enter an hourly rate" });
  }
  if (req.body?.active !== undefined) next.active = req.body.active ? 1 : 0;
  if (req.body?.passcode) {
    const problem = passcodeProblem(req.body.passcode, { exceptEmployeeId: emp.id });
    if (problem) return res.status(400).json({ error: problem });
    next.passcodeHash = hashPasscode(req.body.passcode);
  }
  db.prepare(`UPDATE employees SET name = ?, hourlyRate = ?, active = ?, passcodeHash = ? WHERE id = ?`).run(
    next.name,
    next.hourlyRate,
    next.active,
    next.passcodeHash,
    emp.id
  );
  res.json(publicEmployee(next));
});

// ── the weekly report ───────────────────────────────────────────────────
router.get("/employees/:id/report", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  res.json(buildReport(emp, periodFrom(req.query.periodStart)));
});

// past weeks at a glance, for jumping back to one
router.get("/employees/:id/weeks", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  const current = periodStartFor();
  const weeks = [];
  for (let i = 0; i < 16; i++) {
    const start = addDays(current, -7 * i);
    const r = buildReport(emp, start);
    weeks.push({
      periodStart: start,
      label: r.label,
      totalHours: r.pay.totalHours,
      grossPay: r.pay.grossPay,
      bonus: r.pay.bonus,
      submittedAt: r.submissions[0]?.submittedAt || null,
    });
  }
  res.json({ weeks });
});

// Tapping "Submit payroll": freezes a copy of the report and hands back
// the email (to / subject / body) for the phone to open in its mail app.
router.post("/employees/:id/submit", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  const periodStart = periodFrom(req.body?.periodStart);
  const { payrollEmail } = getPayrollSettings();
  if (!payrollEmail) return res.status(400).json({ error: "Add the payroll person's email first (Payroll settings)" });
  const report = buildReport(emp, periodStart);
  if (report.openShift) {
    return res.status(409).json({ error: `${emp.name} is still clocked in for this week — clock the shift out first` });
  }
  const email = buildPayrollEmail(report, { to: payrollEmail });
  const submittedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO payroll_submissions (id, employeeId, periodStart, report, sentTo, submittedAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), emp.id, periodStart, JSON.stringify({ ...report, email }), payrollEmail, submittedAt);
  res.json({ email, report: buildReport(emp, periodStart) });
});

// preview the email without recording a submission
router.get("/employees/:id/email", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  const report = buildReport(emp, periodFrom(req.query.periodStart));
  res.json(buildPayrollEmail(report, { to: getPayrollSettings().payrollEmail }));
});

// ── piece rate ──────────────────────────────────────────────────────────
router.post("/employees/:id/piece", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: "Enter an amount" });
  const periodStart = periodFrom(req.body?.periodStart);
  db.prepare(
    `INSERT INTO piece_work (id, employeeId, periodStart, description, amount, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    emp.id,
    periodStart,
    String(req.body?.description || "").trim().slice(0, 200),
    Math.round(amount * 100) / 100,
    new Date().toISOString()
  );
  res.status(201).json(buildReport(emp, periodStart));
});

router.delete("/piece/:id", (req, res) => {
  const item = db.prepare(`SELECT * FROM piece_work WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  db.prepare(`DELETE FROM piece_work WHERE id = ?`).run(item.id);
  res.json(buildReport(getEmployee(item.employeeId), item.periodStart));
});

// ── time entries ────────────────────────────────────────────────────────
function reportForEntry(entry) {
  const emp = getEmployee(entry.employeeId);
  return buildReport(emp, periodStartFor(new Date(entry.clockIn)));
}

router.post("/employees/:id/entries", (req, res) => {
  const emp = employeeOr404(req.params.id, res);
  if (!emp) return;
  const v = validateShift(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  if (overlaps(emp.id, v.start.toISOString(), v.end.toISOString())) {
    return res.status(409).json({ error: "That overlaps a shift already on the timesheet" });
  }
  const now = new Date().toISOString();
  const entry = {
    id: randomUUID(),
    employeeId: emp.id,
    clockIn: v.start.toISOString(),
    clockOut: v.end.toISOString(),
    note: String(req.body?.note || "").trim().slice(0, 500),
  };
  db.prepare(
    `INSERT INTO time_entries (id, employeeId, clockIn, clockOut, source, status, note, createdAt)
     VALUES (@id, @employeeId, @clockIn, @clockOut, 'manual', 'approved', @note, @createdAt)`
  ).run({ ...entry, createdAt: now });
  res.status(201).json(reportForEntry(entry));
});

router.patch("/entries/:id", (req, res) => {
  const entry = entryOr404(req.params.id, res);
  if (!entry) return;
  const body = req.body || {};
  const merged = {
    clockIn: body.clockIn !== undefined ? body.clockIn : entry.clockIn,
    clockOut: body.clockOut !== undefined ? body.clockOut : entry.clockOut,
  };
  const v = validateShift(merged, { allowOpen: !entry.clockOut });
  if (v.error) return res.status(400).json({ error: v.error });
  if (overlaps(entry.employeeId, v.start.toISOString(), (v.end || new Date()).toISOString(), entry.id)) {
    return res.status(409).json({ error: "That overlaps another shift on the timesheet" });
  }
  const timesChanged = v.start.toISOString() !== entry.clockIn || (v.end ? v.end.toISOString() : null) !== entry.clockOut;
  const status = body.status === "approved" ? "approved" : entry.status;
  // approving a request the employee had pending while he's also got an
  // open shift is fine — they never overlap (checked above)
  db.prepare(`UPDATE time_entries SET clockIn = ?, clockOut = ?, note = ?, status = ?, source = ?, updatedAt = ? WHERE id = ?`).run(
    v.start.toISOString(),
    v.end ? v.end.toISOString() : null,
    body.note !== undefined ? String(body.note).trim().slice(0, 500) : entry.note,
    status,
    timesChanged && entry.source === "app" ? "manual" : entry.source,
    new Date().toISOString(),
    entry.id
  );
  const updated = db.prepare(`SELECT * FROM time_entries WHERE id = ?`).get(entry.id);
  // moving a shift into a different week returns that week's report
  res.json(reportForEntry(updated));
});

// deleting is also how a missed-punch request gets turned down
router.delete("/entries/:id", (req, res) => {
  const entry = entryOr404(req.params.id, res);
  if (!entry) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM gps_points WHERE timeEntryId = ?`).run(entry.id);
    db.prepare(`DELETE FROM time_entries WHERE id = ?`).run(entry.id);
  })();
  res.json(reportForEntry(entry));
});

// ── GPS ────────────────────────────────────────────────────────────────
function entryPoints(entryId) {
  return db.prepare(`SELECT ts, lat, lng, accuracy, kind FROM gps_points WHERE timeEntryId = ? ORDER BY ts`).all(entryId);
}

router.get("/entries/:id/gps", (req, res) => {
  const entry = entryOr404(req.params.id, res);
  if (!entry) return;
  // for a missed-punch request there's nothing recorded inside it (he
  // wasn't on the clock); the nearest fixes either side of it are the
  // best evidence there is of where he was, so show those
  const before = db
    .prepare(`SELECT ts, lat, lng, accuracy, kind FROM gps_points WHERE employeeId = ? AND ts <= ? ORDER BY ts DESC LIMIT 1`)
    .get(entry.employeeId, entry.clockIn);
  const after = entry.clockOut
    ? db
        .prepare(`SELECT ts, lat, lng, accuracy, kind FROM gps_points WHERE employeeId = ? AND ts >= ? ORDER BY ts LIMIT 1`)
        .get(entry.employeeId, entry.clockOut)
    : null;
  res.json({ points: entryPoints(entry.id), nearestBefore: before || null, nearestAfter: after || null, mapsEnabled: googleConfigured() });
});

const MAX_MAP_POINTS = 90;

router.get("/entries/:id/map.png", async (req, res, next) => {
  const entry = entryOr404(req.params.id, res);
  if (!entry) return;
  if (!googleConfigured()) return res.status(404).end();
  const pts = entryPoints(entry.id);
  if (!pts.length) return res.status(404).end();
  const step = Math.max(1, Math.ceil(pts.length / MAX_MAP_POINTS));
  const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const fmt = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const params = [`size=600x360`, `scale=2`, `maptype=hybrid`];
  if (sampled.length > 1) params.push(`path=color:0xEC4139cc|weight:4|${sampled.map(fmt).join("|")}`);
  const first = pts.find((p) => p.kind === "in") || pts[0];
  const last = pts.findLast((p) => p.kind === "out") || (pts.length > 1 ? pts[pts.length - 1] : null);
  params.push(`markers=color:green|label:I|${fmt(first)}`);
  if (last && last !== first) params.push(`markers=color:red|label:O|${fmt(last)}`);
  if (sampled.length === 1) params.push(`zoom=16`);
  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).end();
    res.set("Content-Type", r.headers.get("content-type") || "image/png");
    res.set("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    if (err.name === "TimeoutError") return res.status(504).end();
    next(err);
  }
});

export default router;
