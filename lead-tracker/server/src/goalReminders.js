import { withTenant } from "./db/pool.js";
import { listTenants } from "./auth/users.js";
import { sendPushToUser } from "./pushService.js";
import { localMonthKey } from "./businessTime.js";

// Nudges each tenant user (admin or PM) once at the start of a new month if that month's
// income goal hasn't been (re)confirmed yet -- mirrors the in-app monthly prompt, but as
// a push so it reaches them even before they next open the app. Goals are per-user now
// (user_goals), so this reminder is per-user too, not one global nag.
async function sweepTenant(tenant) {
  await withTenant(tenant.id, async (client) => {
    const monthKey = localMonthKey(new Date(), tenant.timezone);
    const { rows } = await client.query(
      `SELECT g.user_id, g.month_confirmed, g.month_push_sent_month FROM user_goals g
       JOIN users u ON u.id = g.user_id WHERE g.tenant_id = $1 AND u.disabled_at IS NULL`
    , [tenant.id]);

    for (const row of rows) {
      if (row.month_confirmed === monthKey) continue;
      if (row.month_push_sent_month === monthKey) continue;

      await client.query(
        `UPDATE user_goals SET month_push_sent_month = $2 WHERE tenant_id = $1 AND user_id = $3`,
        [tenant.id, monthKey, row.user_id]
      );
      await sendPushToUser(tenant.id, row.user_id, {
        title: "New month, new goal",
        body: "How much do you want to make this month? Set your income goal in the app.",
      }).catch((err) => console.error("goal reminder push failed:", err.message));
    }
  });
}

export async function sendDueGoalReminders() {
  const tenants = await listTenants();
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    await sweepTenant(tenant).catch((err) => console.error(`goal reminder sweep failed for tenant ${tenant.id}:`, err.message));
  }
}

export function startGoalReminderScheduler() {
  sendDueGoalReminders().catch((err) => console.error("goal reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueGoalReminders().catch((err) => console.error("goal reminder sweep failed:", err.message));
  }, 60 * 60 * 1000).unref();
}
