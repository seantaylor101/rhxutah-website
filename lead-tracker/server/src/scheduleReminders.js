import { db } from "./db.js";
import { sendPushToRole } from "./pushService.js";
import { createNotification } from "./notifications.js";
import { BUSINESS_TZ } from "./businessTime.js";

const SWEEP_MS = 5 * 60 * 1000;

function localDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

// see appointmentDigest.js's localHour for why the % 24 guard is here
function localHour(date) {
  const raw = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", hour12: false }).format(date)
  );
  return raw % 24;
}

function readSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : "";
}

function writeSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key, value });
}

// Won jobs still sitting in "won" instead of moved to "scheduled" — skipped
// when Sean is the tagged manager, since scheduling those is his job, not
// something Dave needs a reminder about.
function unscheduledWonLeads() {
  return db
    .prepare(`SELECT * FROM leads WHERE stage = 'won' AND archived = 0 AND (manager IS NULL OR manager != 'Sean')`)
    .all();
}

// Once-a-day push (plus a matching in-app alert) to the PM, starting at 7am
// local, listing won jobs that still haven't been moved to "scheduled".
// Dedup'd by local calendar date (scheduleReminderSentDate in settings), same
// approach as the appointment digests in appointmentDigest.js — a
// late-starting server still catches up instead of silently skipping the
// day. Unlike those digests, this sends nothing when there's no backlog (but
// still marks the day handled) — it's a nag about jobs piling up unscheduled,
// not a daily all-clear.
export async function sendDueScheduleReminders() {
  const now = new Date();
  if (localHour(now) < 7) return;

  const todayKey = localDateKey(now);
  if (readSetting("scheduleReminderSentDate") === todayKey) return;
  writeSetting("scheduleReminderSentDate", todayKey);

  const leads = unscheduledWonLeads();
  if (leads.length === 0) return;

  const title = `${leads.length} won job${leads.length === 1 ? "" : "s"} need${leads.length === 1 ? "s" : ""} scheduling`;
  const body = leads.map((l) => `${l.name}${l.job ? ` (${l.job})` : ""}`).join("\n");

  try {
    createNotification({ title, body, role: "viewer" });
  } catch (err) {
    console.error("failed to log schedule reminder notification:", err.message);
  }

  await sendPushToRole("viewer", { title, body }).catch((err) =>
    console.error("schedule reminder push failed:", err.message)
  );
}

export function startScheduleReminderScheduler() {
  sendDueScheduleReminders().catch((err) => console.error("schedule reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueScheduleReminders().catch((err) => console.error("schedule reminder sweep failed:", err.message));
  }, SWEEP_MS);
}
