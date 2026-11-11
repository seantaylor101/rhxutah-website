import { db } from "./db.js";
import { BUSINESS_TZ } from "./businessTime.js";

// ── Settings ───────────────────────────────────────────────────────────
// payrollEmail: who "Submit payroll" addresses the email to
// payrollWeekStart: 0 = Sunday … 6 = Saturday; the pay week runs 7 days from it
export function getPayrollSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('payrollEmail', 'payrollWeekStart')`).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const weekStart = Number(map.payrollWeekStart);
  return {
    payrollEmail: map.payrollEmail || "",
    weekStartDay: Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6 ? weekStart : 1,
  };
}

export function savePayrollSettings({ payrollEmail, weekStartDay }) {
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  if (payrollEmail !== undefined) upsert.run("payrollEmail", String(payrollEmail).trim());
  if (weekStartDay !== undefined) upsert.run("payrollWeekStart", String(weekStartDay));
  return getPayrollSettings();
}

// ── Business-local dates ───────────────────────────────────────────────
// Pay weeks start at midnight Utah time, not UTC, so every boundary is
// worked out in BUSINESS_TZ. Dates are passed around as "YYYY-MM-DD".

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function localParts(date) {
  const map = Object.fromEntries(partsFmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +map.year, m: +map.month, d: +map.day, h: +map.hour, min: +map.minute, s: +map.second };
}

// how far ahead of UTC Utah's wall clock is at this instant (negative)
function tzOffsetMs(date) {
  const p = localParts(date);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

export function isDateKey(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function localDateKey(date = new Date()) {
  const p = localParts(date);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// the UTC instant of midnight at the start of this Utah date
export function localMidnight(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - tzOffsetMs(new Date(wall));
  guess = wall - tzOffsetMs(new Date(guess)); // second pass settles DST days
  return new Date(guess);
}

export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekday(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

export function periodStartFor(date = new Date(), weekStartDay = getPayrollSettings().weekStartDay) {
  const key = localDateKey(date);
  return addDays(key, -((weekday(key) - weekStartDay + 7) % 7));
}

// snaps any date to the start of the pay week it falls in
export function normalizePeriodStart(dateKey, weekStartDay = getPayrollSettings().weekStartDay) {
  return addDays(dateKey, -((weekday(dateKey) - weekStartDay + 7) % 7));
}

export function periodBounds(periodStart) {
  return {
    start: localMidnight(periodStart),
    end: localMidnight(addDays(periodStart, 7)),
    lastDay: addDays(periodStart, 6),
  };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function shortDate(dateKey) {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${DAY_NAMES[weekday(dateKey)]} ${m}/${d}`;
}

export function periodLabel(periodStart) {
  const last = addDays(periodStart, 6);
  return `${shortDate(periodStart)} – ${shortDate(last)}, ${last.slice(0, 4)}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" });
export function localTime(iso) {
  return timeFmt.format(new Date(iso));
}

// ── Money / hours ──────────────────────────────────────────────────────
const cents = (n) => Math.round(n * 100) / 100;
const hrs = (n) => Math.round(n * 100) / 100;

export function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Time and a half for anything over 8 hours in a day, and — required by
// federal law regardless — for straight-time hours past 40 in the week.
// An hour already paid as daily overtime isn't counted again toward the 40.
export const DAILY_OVERTIME_AFTER_HOURS = 8;
export const OVERTIME_AFTER_HOURS = 40;

export function entryHours(entry, now = new Date()) {
  const end = entry.clockOut ? new Date(entry.clockOut) : now;
  return Math.max(0, (end - new Date(entry.clockIn)) / 3600000);
}

// The whole pay calculation, in one place, so the owner's screen, the
// email, and the saved submission can never disagree.
//
//   hourly wages = regular hours × rate + overtime hours × 1.5 × rate
//   bonus        = piece rate earned − hourly wages, if that's positive
//
// Overtime: a production bonus like this is "non-discretionary" under the
// FLSA, so it has to be folded into the regular rate for any week over 40
// hours. That works out to an extra ½ × (bonus ÷ total hours) for each
// overtime hour, shown as its own line so the payroll person can see it.
// dayHours: hours worked on each day of the pay week
export function computePay({ dayHours, hourlyRate, pieceTotal }) {
  const total = hrs(dayHours.reduce((s, h) => s + h, 0));
  const dailyOvertimeHours = hrs(dayHours.reduce((s, h) => s + Math.max(0, h - DAILY_OVERTIME_AFTER_HOURS), 0));
  const straightTime = total - dailyOvertimeHours;
  const weeklyOvertimeHours = hrs(Math.max(0, straightTime - OVERTIME_AFTER_HOURS));
  const overtimeHours = hrs(dailyOvertimeHours + weeklyOvertimeHours);
  const regularHours = hrs(total - overtimeHours);
  const rate = Number(hourlyRate) || 0;
  const regularPay = cents(regularHours * rate);
  const overtimePay = cents(overtimeHours * rate * 1.5);
  const hourlyPay = cents(regularPay + overtimePay);
  const piece = cents(pieceTotal);
  const bonus = cents(Math.max(0, piece - hourlyPay));
  const bonusOvertimeAdjustment =
    bonus > 0 && overtimeHours > 0 && total > 0 ? cents(0.5 * (bonus / total) * overtimeHours) : 0;
  return {
    totalHours: total,
    regularHours,
    overtimeHours,
    dailyOvertimeHours,
    weeklyOvertimeHours,
    hourlyRate: rate,
    regularPay,
    overtimePay,
    hourlyPay,
    pieceTotal: piece,
    bonus,
    bonusOvertimeAdjustment,
    grossPay: cents(hourlyPay + bonus + bonusOvertimeAdjustment),
  };
}

function gpsSummaryByEntry(entryIds) {
  if (!entryIds.length) return new Map();
  const rows = db
    .prepare(
      `SELECT timeEntryId, COUNT(*) AS points,
              SUM(kind = 'in') AS hasIn, SUM(kind = 'out') AS hasOut
         FROM gps_points WHERE timeEntryId IN (${entryIds.map(() => "?").join(",")})
        GROUP BY timeEntryId`
    )
    .all(...entryIds);
  return new Map(rows.map((r) => [r.timeEntryId, { points: r.points, hasIn: !!r.hasIn, hasOut: !!r.hasOut }]));
}

export function entriesInPeriod(employeeId, periodStart) {
  const { start, end } = periodBounds(periodStart);
  return db
    .prepare(
      `SELECT * FROM time_entries WHERE employeeId = ? AND clockIn >= ? AND clockIn < ? ORDER BY clockIn`
    )
    .all(employeeId, start.toISOString(), end.toISOString());
}

// Hours side only — what the employee's own screen shows (no pay figures).
export function hoursForPeriod(employeeId, periodStart, now = new Date()) {
  const all = entriesInPeriod(employeeId, periodStart);
  const gps = gpsSummaryByEntry(all.map((e) => e.id));
  const entries = all.map((e) => ({
    ...e,
    hours: hrs(entryHours(e, now)),
    localDate: localDateKey(new Date(e.clockIn)),
    gps: gps.get(e.id) || { points: 0, hasIn: false, hasOut: false },
  }));
  const approved = entries.filter((e) => e.status === "approved");
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(periodStart, i);
    const dayEntries = approved.filter((e) => e.localDate === date);
    const dayTotal = dayEntries.reduce((s, e) => s + entryHours(e, now), 0);
    days.push({
      date,
      label: shortDate(date),
      hours: hrs(dayTotal),
      overtime: hrs(Math.max(0, dayTotal - DAILY_OVERTIME_AFTER_HOURS)),
    });
  }
  const totalHours = hrs(approved.reduce((s, e) => s + entryHours(e, now), 0));
  return {
    periodStart,
    periodEnd: addDays(periodStart, 6),
    label: periodLabel(periodStart),
    entries,
    days,
    totalHours,
    pendingHours: hrs(entries.filter((e) => e.status === "pending").reduce((s, e) => s + entryHours(e, now), 0)),
    openShift: approved.some((e) => !e.clockOut),
  };
}

export function buildReport(employee, periodStart, now = new Date()) {
  const hours = hoursForPeriod(employee.id, periodStart, now);
  const piece = db
    .prepare(`SELECT * FROM piece_work WHERE employeeId = ? AND periodStart = ? ORDER BY createdAt`)
    .all(employee.id, periodStart);
  const pay = computePay({
    dayHours: hours.days.map((d) => d.hours),
    hourlyRate: employee.hourlyRate,
    pieceTotal: piece.reduce((s, p) => s + p.amount, 0),
  });
  const submissions = db
    .prepare(`SELECT id, sentTo, submittedAt, report FROM payroll_submissions WHERE employeeId = ? AND periodStart = ? ORDER BY submittedAt DESC`)
    .all(employee.id, periodStart)
    .map((s) => {
      const snap = JSON.parse(s.report);
      return { id: s.id, sentTo: s.sentTo, submittedAt: s.submittedAt, grossPay: snap.pay?.grossPay, totalHours: snap.pay?.totalHours };
    });

  const warnings = [];
  if (hours.openShift) warnings.push(`${employee.name} is still clocked in — those hours are counted up to right now.`);
  const pending = hours.entries.filter((e) => e.status === "pending");
  if (pending.length) {
    warnings.push(
      `${pending.length} missed-punch request${pending.length === 1 ? "" : "s"} (${hours.pendingHours} hrs) waiting on you — not counted until approved.`
    );
  }
  if (!piece.length) warnings.push("No piece rate entered for this week yet.");
  if (periodStart > periodStartFor(now)) warnings.push("This pay week hasn't started yet.");
  else if (now < periodBounds(periodStart).end) warnings.push("This pay week isn't over yet.");

  return {
    employee: { id: employee.id, name: employee.name, hourlyRate: employee.hourlyRate },
    ...hours,
    piece,
    pay,
    warnings,
    submissions,
    prevPeriodStart: addDays(periodStart, -7),
    nextPeriodStart: addDays(periodStart, 7),
    currentPeriodStart: periodStartFor(now),
  };
}

// plain text — goes into a mailto: link, so no HTML and nothing fancy
export function buildPayrollEmail(report, { to = "" } = {}) {
  const p = report.pay;
  const lines = [];
  lines.push(`Payroll for ${report.employee.name}`);
  lines.push(`Pay week: ${report.label}`);
  lines.push("");
  lines.push("HOURS");
  for (const d of report.days) {
    lines.push(`  ${d.label.padEnd(10)} ${d.hours.toFixed(2)}` + (d.overtime > 0 ? `  (${d.overtime.toFixed(2)} OT over 8 hrs)` : ""));
  }
  lines.push(`  Total: ${p.totalHours.toFixed(2)} hrs` + (p.overtimeHours > 0 ? ` (${p.regularHours.toFixed(2)} regular + ${p.overtimeHours.toFixed(2)} overtime)` : ""));
  lines.push("");
  lines.push("HOURLY");
  lines.push(`  Rate: ${money(p.hourlyRate)}/hr`);
  lines.push(`  Regular: ${p.regularHours.toFixed(2)} hrs × ${money(p.hourlyRate)} = ${money(p.regularPay)}`);
  if (p.overtimeHours > 0) {
    lines.push(`  Overtime (time and a half): ${p.overtimeHours.toFixed(2)} hrs × ${money(p.hourlyRate * 1.5)} = ${money(p.overtimePay)}`);
    const why = [];
    if (p.dailyOvertimeHours > 0) why.push(`${p.dailyOvertimeHours.toFixed(2)} hrs over 8 in a day`);
    if (p.weeklyOvertimeHours > 0) why.push(`${p.weeklyOvertimeHours.toFixed(2)} hrs over 40 in the week`);
    lines.push(`    (${why.join(" + ")})`);
  }
  lines.push(`  Hourly wages: ${money(p.hourlyPay)}`);
  lines.push("");
  lines.push("PIECE RATE");
  if (report.piece.length) {
    for (const item of report.piece) lines.push(`  ${item.description || "Piece work"}: ${money(item.amount)}`);
  } else {
    lines.push("  (none this week)");
  }
  lines.push(`  Piece rate earned: ${money(p.pieceTotal)}`);
  lines.push("");
  lines.push("BONUS");
  if (p.bonus > 0) {
    lines.push(`  Piece rate over hourly wages: ${money(p.pieceTotal)} − ${money(p.hourlyPay)} = ${money(p.bonus)}`);
    if (p.bonusOvertimeAdjustment > 0) {
      lines.push(
        `  Overtime on bonus: ${money(p.bonusOvertimeAdjustment)} (½ × bonus ÷ ${p.totalHours.toFixed(2)} hrs × ${p.overtimeHours.toFixed(2)} OT hrs — bonus folded into the regular rate)`
      );
    }
  } else {
    lines.push("  None — piece rate did not exceed hourly wages.");
  }
  lines.push("");
  lines.push(`TOTAL GROSS PAY: ${money(p.grossPay)}`);
  lines.push(`  = hourly ${money(p.hourlyPay)} + bonus ${money(p.bonus + p.bonusOvertimeAdjustment)}`);
  lines.push("");
  lines.push("Shifts:");
  for (const e of report.entries.filter((x) => x.status === "approved")) {
    const out = e.clockOut ? localTime(e.clockOut) : "still clocked in";
    lines.push(`  ${shortDate(e.localDate)}  ${localTime(e.clockIn)} – ${out}  (${e.hours.toFixed(2)} hrs)${e.source !== "app" ? " *edited" : ""}`);
  }
  if (report.pendingHours > 0) {
    lines.push("");
    lines.push(`Not included: ${report.pendingHours.toFixed(2)} hrs of missed-punch requests not yet approved.`);
  }
  lines.push("");
  lines.push("Sent from Lead Hammer — RHX Utah");

  return {
    to,
    subject: `Payroll — ${report.employee.name} — ${report.label} — ${money(p.grossPay)}`,
    body: lines.join("\n"),
  };
}
