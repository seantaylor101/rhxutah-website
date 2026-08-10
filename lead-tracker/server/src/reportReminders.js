import { db } from "./db.js";
import { sendPushToAll } from "./pushService.js";
import { createNotification } from "./notifications.js";

// UTC calendar-day key — good enough for "once per day" dedup; doesn't need
// to match the owner's local timezone precisely.
function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// Nags once per day, starting the day a lead lands in "completed", until its
// final report (material/labor cost entry) is marked done.
export async function sendDueReportReminders() {
  const rows = db
    .prepare(`SELECT * FROM leads WHERE completedAt IS NOT NULL AND reportCompletedAt IS NULL`)
    .all();
  const today = dayKey(new Date().toISOString());

  for (const lead of rows) {
    if (lead.lastReportReminderAt && dayKey(lead.lastReportReminderAt) === today) continue;

    const title = "Complete final report";
    const body = `${lead.name}${lead.job ? " — " + lead.job : ""}`;
    try {
      createNotification({ leadId: lead.id, title, body });
    } catch (err) {
      console.error("failed to log report reminder notification:", err.message);
    }
    sendPushToAll({ title, body, leadId: lead.id }).catch((err) =>
      console.error("report reminder push failed:", err.message)
    );
    db.prepare(`UPDATE leads SET lastReportReminderAt = ? WHERE id = ?`).run(new Date().toISOString(), lead.id);
  }
}

export function startReportReminderScheduler() {
  sendDueReportReminders().catch((err) => console.error("report reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueReportReminders().catch((err) => console.error("report reminder sweep failed:", err.message));
  }, 60 * 60 * 1000);
}
