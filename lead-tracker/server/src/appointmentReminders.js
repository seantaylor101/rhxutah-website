import { db } from "./db.js";
import { sendPushToRole } from "./pushService.js";

const BUSINESS_TZ = "America/Denver";

// "today" and "hour" in the business's local timezone, regardless of what
// timezone the server process itself is running in
function localDateAndHour(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  // a 24-hour formatToParts can report hour "24" for local midnight
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  return { day: `${map.year}-${map.month}-${map.day}`, hour };
}

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Once it's 7am or later (business local time), push a same-day reminder for
// every lead with an appointment scheduled for today that hasn't already
// gotten its reminder. Rescheduling an appointment clears
// appointmentReminderSentAt (see routes/leads.js PATCH), so a moved
// appointment gets a fresh reminder rather than being silently skipped.
export async function sendDueAppointmentReminders() {
  const now = new Date();
  const { day: today, hour } = localDateAndHour(now);
  if (hour < 7) return;

  const rows = db
    .prepare(
      `SELECT * FROM leads WHERE appointmentAt IS NOT NULL AND appointmentReminderSentAt IS NULL`
    )
    .all();

  for (const lead of rows) {
    const { day: apptDay } = localDateAndHour(new Date(lead.appointmentAt));
    if (apptDay !== today) continue;

    const time = formatLocalTime(lead.appointmentAt);
    try {
      await sendPushToRole("owner", {
        title: "Sales appointment today",
        body: `You have a sales appointment today at ${time}!`,
        leadId: lead.id,
      });
    } catch (err) {
      console.error("appointment reminder push failed:", err.message);
    }
    db.prepare(`UPDATE leads SET appointmentReminderSentAt = ? WHERE id = ?`).run(now.toISOString(), lead.id);
  }
}

export function startAppointmentReminderScheduler() {
  sendDueAppointmentReminders().catch((err) => console.error("appointment reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueAppointmentReminders().catch((err) => console.error("appointment reminder sweep failed:", err.message));
  }, 15 * 60 * 1000);
}
