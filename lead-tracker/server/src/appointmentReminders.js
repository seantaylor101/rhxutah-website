import { db } from "./db.js";
import { sendPushToRole } from "./pushService.js";
import { BUSINESS_TZ } from "./businessTime.js";

const REMINDER_LEAD_MS = 60 * 60 * 1000; // fire starting 1 hour before the appointment
const STALE_MS = 60 * 60 * 1000; // more than an hour past due — not worth a late reminder anymore

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Sends a push once the appointment is within an hour out. Fires on
// whichever sweep tick first catches that window (checked every 5 minutes,
// so it lands roughly 55-60 minutes ahead) rather than at a fixed clock
// time, so it stays correct as an appointment gets scheduled or rescheduled
// to any time of day. Rescheduling clears appointmentReminderSentAt (see
// routes/leads.js PATCH), so a moved appointment gets a fresh reminder
// instead of being silently skipped. If a long server gap means the
// appointment is already well past by the time this runs, it's marked sent
// without actually notifying — a reminder that arrives after the meeting
// was supposed to start isn't useful.
export async function sendDueAppointmentReminders() {
  const now = Date.now();
  const rows = db
    .prepare(`SELECT * FROM leads WHERE appointmentAt IS NOT NULL AND appointmentReminderSentAt IS NULL`)
    .all();

  for (const lead of rows) {
    const apptTime = new Date(lead.appointmentAt).getTime();
    if (isNaN(apptTime) || now < apptTime - REMINDER_LEAD_MS) continue;

    if (now <= apptTime + STALE_MS) {
      const time = formatLocalTime(lead.appointmentAt);
      try {
        await sendPushToRole("owner", {
          title: "Sales appointment in 1 hour",
          body: `${lead.name} at ${time}`,
          leadId: lead.id,
        });
      } catch (err) {
        console.error("appointment reminder push failed:", err.message);
      }
    }
    db.prepare(`UPDATE leads SET appointmentReminderSentAt = ? WHERE id = ?`).run(new Date(now).toISOString(), lead.id);
  }
}

export function startAppointmentReminderScheduler() {
  sendDueAppointmentReminders().catch((err) => console.error("appointment reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueAppointmentReminders().catch((err) => console.error("appointment reminder sweep failed:", err.message));
  }, 5 * 60 * 1000);
}
