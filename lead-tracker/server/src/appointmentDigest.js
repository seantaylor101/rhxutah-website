import { db } from "./db.js";
import { sendPushToRole } from "./pushService.js";

const BUSINESS_TZ = "America/Denver";
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

function localHour(date) {
  // % 24 guards against a real cross-version Intl quirk: hour12:false
  // returns "24" for midnight on Node 20 (this app's runtime, per the
  // Dockerfile) but "00" on Node 22+ — an un-normalized "24" would satisfy
  // both hour >= 7 and hour >= 21 below and fire both digests at midnight
  const raw = Number(new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", hour12: false }).format(date));
  return raw % 24;
}

// 0 = Sunday ... 6 = Saturday. Built from the already-computed local
// calendar date (not re-parsed from a locale string), so this can't hit
// the same class of Intl/Node-version quirk that bit localHour above.
function localWeekday(date) {
  const [y, m, d] = localDateKey(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// same "still on the board" filter the Apple Calendar feed uses (routes/calendar.js)
function appointmentsOnLocalDate(dateKey) {
  return db
    .prepare(`SELECT * FROM leads WHERE appointmentAt IS NOT NULL AND archived = 0`)
    .all()
    .filter((l) => localDateKey(new Date(l.appointmentAt)) === dateKey)
    .sort((a, b) => new Date(a.appointmentAt) - new Date(b.appointmentAt));
}

function digestBody(leads) {
  if (leads.length === 0) return "No appointments scheduled.";
  return leads.map((l) => `${formatLocalTime(l.appointmentAt)} — ${l.name}${l.job ? ` (${l.job})` : ""}`).join("\n");
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

function digestTitle(count, when) {
  if (count === 0) return `No appointments ${when}`;
  return `${count} appointment${count === 1 ? "" : "s"} ${when}`;
}

// Two once-a-day pushes to the owner: a same-day rundown starting at 7am
// local, and a look-ahead at tomorrow's schedule starting at 9pm local.
// Dedup'd by local calendar date (morningDigestSentDate/eveningDigestSentDate
// in settings) rather than a fixed clock check, so — like the other
// reminder sweeps in this file's siblings — a late-starting server still
// catches up instead of silently skipping the day.
//
// No Sunday morning digest (nothing's ever scheduled that day) and no
// Saturday evening digest (its look-ahead would just be that same empty
// Sunday) — both still get marked "sent" for the day so the sweep doesn't
// keep re-evaluating them every 5 minutes for nothing.
export async function sendDueAppointmentDigests() {
  const now = new Date();
  const hour = localHour(now);
  const todayKey = localDateKey(now);
  const weekday = localWeekday(now);

  if (hour >= 7 && readSetting("morningDigestSentDate") !== todayKey) {
    writeSetting("morningDigestSentDate", todayKey);
    if (weekday !== 0) {
      const leads = appointmentsOnLocalDate(todayKey);
      await sendPushToRole("owner", {
        title: digestTitle(leads.length, "today"),
        body: digestBody(leads),
      }).catch((err) => console.error("morning appointment digest push failed:", err.message));
    }
  }

  if (hour >= 21 && readSetting("eveningDigestSentDate") !== todayKey) {
    writeSetting("eveningDigestSentDate", todayKey);
    if (weekday !== 6) {
      const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
      const leads = appointmentsOnLocalDate(tomorrowKey);
      await sendPushToRole("owner", {
        title: digestTitle(leads.length, "tomorrow"),
        body: digestBody(leads),
      }).catch((err) => console.error("evening appointment digest push failed:", err.message));
    }
  }
}

export function startAppointmentDigestScheduler() {
  sendDueAppointmentDigests().catch((err) => console.error("appointment digest sweep failed:", err.message));
  setInterval(() => {
    sendDueAppointmentDigests().catch((err) => console.error("appointment digest sweep failed:", err.message));
  }, SWEEP_MS);
}
