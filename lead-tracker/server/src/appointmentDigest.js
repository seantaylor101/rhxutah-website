import { withTenant } from "./db/pool.js";
import { listTenants } from "./auth/users.js";
import { sendPushToTenantAdmins } from "./pushService.js";
import { localDateKey } from "./businessTime.js";

const SWEEP_MS = 5 * 60 * 1000;

function localHour(date, timezone) {
  // % 24 guards a real cross-version Intl quirk: hour12:false returns "24" for midnight
  // on some Node versions but "00" on others -- an un-normalized "24" would satisfy both
  // hour >= 7 and hour >= 21 below and fire both digests at midnight.
  const raw = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(date));
  return raw % 24;
}

function localWeekday(date, timezone) {
  const [y, m, d] = localDateKey(date, timezone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function formatLocalTime(iso, timezone) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function digestBody(leads, timezone) {
  if (leads.length === 0) return "No appointments scheduled.";
  return leads.map((l) => `${formatLocalTime(l.appointment_at, timezone)} — ${l.name}${l.job ? ` (${l.job})` : ""}`).join("\n");
}

function digestTitle(count, when) {
  if (count === 0) return `No appointments ${when}`;
  return `${count} appointment${count === 1 ? "" : "s"} ${when}`;
}

async function appointmentsOnLocalDate(client, dateKey, timezone) {
  const { rows } = await client.query(
    `SELECT * FROM leads WHERE appointment_at IS NOT NULL AND archived = false`
  );
  return rows
    .filter((l) => localDateKey(new Date(l.appointment_at), timezone) === dateKey)
    .sort((a, b) => new Date(a.appointment_at) - new Date(b.appointment_at));
}

// Two once-a-day pushes to the tenant admins: a same-day rundown starting at 7am local,
// and a look-ahead at tomorrow's schedule starting at 9pm local. Dedup'd by local
// calendar date so a late-starting server still catches up instead of silently skipping
// the day. No Sunday morning digest, no Saturday evening digest (mirrors old behavior).
async function sweepTenant(tenant) {
  await withTenant(tenant.id, async (client) => {
    const now = new Date();
    const tz = tenant.timezone;
    const hour = localHour(now, tz);
    const todayKey = localDateKey(now, tz);
    const weekday = localWeekday(now, tz);

    const { rows } = await client.query(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [tenant.id]);
    const settings = rows[0];

    if (hour >= 7 && settings.morning_digest_sent_date !== todayKey) {
      await client.query(`UPDATE tenant_settings SET morning_digest_sent_date = $2 WHERE tenant_id = $1`, [tenant.id, todayKey]);
      if (weekday !== 0) {
        const leads = await appointmentsOnLocalDate(client, todayKey, tz);
        await sendPushToTenantAdmins(tenant.id, {
          title: digestTitle(leads.length, "today"),
          body: digestBody(leads, tz),
        }).catch((err) => console.error("morning appointment digest push failed:", err.message));
      }
    }

    if (hour >= 21 && settings.evening_digest_sent_date !== todayKey) {
      await client.query(`UPDATE tenant_settings SET evening_digest_sent_date = $2 WHERE tenant_id = $1`, [tenant.id, todayKey]);
      if (weekday !== 6) {
        const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), tz);
        const leads = await appointmentsOnLocalDate(client, tomorrowKey, tz);
        await sendPushToTenantAdmins(tenant.id, {
          title: digestTitle(leads.length, "tomorrow"),
          body: digestBody(leads, tz),
        }).catch((err) => console.error("evening appointment digest push failed:", err.message));
      }
    }
  });
}

export async function sendDueAppointmentDigests() {
  const tenants = await listTenants();
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    await sweepTenant(tenant).catch((err) => console.error(`appointment digest sweep failed for tenant ${tenant.id}:`, err.message));
  }
}

export function startAppointmentDigestScheduler() {
  sendDueAppointmentDigests().catch((err) => console.error("appointment digest sweep failed:", err.message));
  setInterval(() => {
    sendDueAppointmentDigests().catch((err) => console.error("appointment digest sweep failed:", err.message));
  }, SWEEP_MS).unref();
}
