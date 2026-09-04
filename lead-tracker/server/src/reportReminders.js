import { withTenant } from "./db/pool.js";
import { listTenants } from "./auth/users.js";
import { sendPushToTenantAdmins } from "./pushService.js";
import { createNotification } from "./notifications.js";

function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// Nags once per day, starting the day a job lands in "completed", until its final
// report (material/labor cost entry) is marked done. Admin-only: filling out the final
// report is a tenant-admin-gated action, so nagging a PM about it would be noise they
// can't act on.
async function sweepTenant(tenantId) {
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM leads WHERE completed_at IS NOT NULL AND report_completed_at IS NULL`
    );
    const today = dayKey(new Date().toISOString());

    for (const lead of rows) {
      if (lead.last_report_reminder_at && dayKey(lead.last_report_reminder_at) === today) continue;

      const title = "Complete final report";
      const body = `${lead.name}${lead.job ? " — " + lead.job : ""}`;
      try {
        await createNotification(tenantId, { leadId: lead.id, title, body });
      } catch (err) {
        console.error("failed to log report reminder notification:", err.message);
      }
      sendPushToTenantAdmins(tenantId, { title, body, leadId: lead.id }).catch((err) =>
        console.error("report reminder push failed:", err.message)
      );
      await client.query(`UPDATE leads SET last_report_reminder_at = $2 WHERE id = $1`, [
        lead.id,
        new Date().toISOString(),
      ]);
    }
  });
}

// Called with a tenantId right after a job is marked completed (immediate first nag);
// called with no argument by the hourly scheduler, which sweeps every active tenant.
export async function sendDueReportReminders(tenantId) {
  if (tenantId) return sweepTenant(tenantId);
  const tenants = await listTenants();
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    await sweepTenant(tenant.id).catch((err) =>
      console.error(`report reminder sweep failed for tenant ${tenant.id}:`, err.message)
    );
  }
}

export function startReportReminderScheduler() {
  sendDueReportReminders().catch((err) => console.error("report reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueReportReminders().catch((err) => console.error("report reminder sweep failed:", err.message));
  }, 60 * 60 * 1000).unref();
}
