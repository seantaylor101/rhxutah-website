import { withTenant } from "./db/pool.js";
import { listTenants } from "./auth/users.js";
import { sendPushToUser, sendPushToTenantAdmins } from "./pushService.js";

const REMINDER_LEAD_MS = 60 * 60 * 1000; // fire starting 1 hour before the appointment
const STALE_MS = 60 * 60 * 1000; // more than an hour past due — not worth a late reminder anymore

function formatLocalTime(iso, timezone) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// Sends a push once an appointment is within an hour out, to whichever PM the job is
// assigned to (they're the one actually going), or the tenant admins if it's still
// unassigned. Fires on whichever sweep tick first catches the window, same "mark sent
// even if stale" behavior as before.
async function sweepTenant(tenant) {
  await withTenant(tenant.id, async (client) => {
    const now = Date.now();
    const { rows } = await client.query(
      `SELECT * FROM leads WHERE appointment_at IS NOT NULL AND appointment_reminder_sent_at IS NULL`
    );

    for (const lead of rows) {
      const apptTime = new Date(lead.appointment_at).getTime();
      if (isNaN(apptTime) || now < apptTime - REMINDER_LEAD_MS) continue;

      if (now <= apptTime + STALE_MS) {
        const time = formatLocalTime(lead.appointment_at, tenant.timezone);
        const payload = { title: "Sales appointment in 1 hour", body: `${lead.name} at ${time}`, leadId: lead.id };
        try {
          if (lead.assigned_pm_id) await sendPushToUser(tenant.id, lead.assigned_pm_id, payload);
          else await sendPushToTenantAdmins(tenant.id, payload);
        } catch (err) {
          console.error("appointment reminder push failed:", err.message);
        }
      }
      await client.query(`UPDATE leads SET appointment_reminder_sent_at = $2 WHERE id = $1`, [lead.id, new Date(now).toISOString()]);
    }
  });
}

export async function sendDueAppointmentReminders() {
  const tenants = await listTenants();
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    await sweepTenant(tenant).catch((err) => console.error(`appointment reminder sweep failed for tenant ${tenant.id}:`, err.message));
  }
}

export function startAppointmentReminderScheduler() {
  sendDueAppointmentReminders().catch((err) => console.error("appointment reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueAppointmentReminders().catch((err) => console.error("appointment reminder sweep failed:", err.message));
  }, 5 * 60 * 1000).unref();
}
