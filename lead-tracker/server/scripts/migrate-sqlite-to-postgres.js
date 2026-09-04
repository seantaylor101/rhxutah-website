#!/usr/bin/env node
// One-time data migration: loads the existing single-tenant leads.db (SQLite) into an
// ALREADY-ONBOARDED Postgres tenant. This script does not create the tenant or its
// users -- onboard "RHX Utah" through the normal platform-admin flow first (POST
// /api/platform/tenants, or the onboarding UI once it exists), add Dave as a PM through
// the normal account-settings flow, then run this script to backfill the historical
// leads/contacts/warranty data into that tenant.
//
// What it migrates: leads, contacts, warranty_requests, warranty_photos, and the handful
// of tenant-wide settings (overheadPercent, popup toggles, national goal assumptions).
// It also seeds the tenant admin's user_goals row from the old global goal fields.
//
// What it deliberately does NOT migrate, and why:
//   - notifications / activity_log / access_log: these recorded events under the old
//     role-only identity model ("owner"/"viewer"), not real user ids -- there's no
//     faithful mapping to "who did this" in the new per-user model, and losing old
//     history here doesn't lose any business data (the leads/warranty rows themselves
//     carry the meaningful timestamps).
//   - push_subscriptions: browser push endpoints are re-registered automatically the
//     next time each person opens the app and logs in; carrying stale ones over adds
//     nothing.
//   - warranty photo files themselves: this script only migrates the DB rows
//     (filenames). Copy WARRANTY_PHOTOS_DIR's contents to the new deployment's
//     UPLOADS_DIR/warranty-photos separately (a plain file copy, not part of this
//     script) before or after running this.
//
// Usage:
//   TARGET_TENANT_ID=<tenant id> \
//   PM_MANAGER_MAP='{"Dave":"<dave's new user id>"}' \
//   SQLITE_PATH=./data/leads.db \
//   node scripts/migrate-sqlite-to-postgres.js [--dry-run]
//
// PM_MANAGER_MAP maps the old `manager` string (e.g. "Dave") to the new PM's user id in
// the target tenant. Any old lead/warranty ticket whose manager isn't in the map (this
// includes the old "Sean" convention, and anything blank) is left unassigned
// (assigned_pm_id = NULL), i.e. owned directly by the tenant admin -- exactly like a
// freshly created, not-yet-pushed job in the new model.

import "dotenv/config";
import Database from "better-sqlite3";
import { withTenant, closePools } from "../src/db/pool.js";

const SQLITE_PATH = process.env.SQLITE_PATH || "./data/leads.db";
const TARGET_TENANT_ID = process.env.TARGET_TENANT_ID;
const DRY_RUN = process.argv.includes("--dry-run");
let PM_MANAGER_MAP = {};
try {
  PM_MANAGER_MAP = JSON.parse(process.env.PM_MANAGER_MAP || "{}");
} catch {
  console.error("PM_MANAGER_MAP must be valid JSON, e.g. '{\"Dave\":\"<user-id>\"}'");
  process.exit(1);
}

if (!TARGET_TENANT_ID) {
  console.error("TARGET_TENANT_ID env var is required -- onboard the tenant first, then pass its id here.");
  process.exit(1);
}

function toBool(v) {
  return !!v;
}
function toIso(v) {
  return v || null;
}
function toJsonArray(v) {
  if (!v) return "[]";
  try {
    const parsed = JSON.parse(v);
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return "[]";
  }
}

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const leads = sqlite.prepare("SELECT * FROM leads").all();
  const contacts = sqlite.prepare("SELECT * FROM contacts").all();
  const warrantyRequests = sqlite.prepare("SELECT * FROM warranty_requests").all();
  const warrantyPhotos = sqlite.prepare("SELECT * FROM warranty_photos").all();
  const settingsRows = sqlite.prepare("SELECT * FROM settings").all();
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

  console.log(
    `Read from SQLite: ${leads.length} leads, ${contacts.length} contacts, ` +
      `${warrantyRequests.length} warranty requests, ${warrantyPhotos.length} warranty photos.`
  );

  if (DRY_RUN) {
    console.log("--dry-run: not writing anything. Re-run without --dry-run to apply.");
    sqlite.close();
    return;
  }

  await withTenant(TARGET_TENANT_ID, async (client) => {
    // --- Verify the tenant admin exists (also confirms TARGET_TENANT_ID is real and
    // this connection's RLS context is correctly scoped) before writing anything.
    const { rows: admins } = await client.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'tenant_admin' ORDER BY created_at ASC LIMIT 1`,
      [TARGET_TENANT_ID]
    );
    if (!admins.length) throw new Error(`No tenant_admin found for tenant ${TARGET_TENANT_ID} -- onboard it first.`);
    const tenantAdminId = admins[0].id;

    // --- contacts (id reused as-is -- SQLite ids are already randomUUID() strings)
    for (const c of contacts) {
      await client.query(
        `INSERT INTO contacts (id, tenant_id, name, phone, email, address, lead_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, TARGET_TENANT_ID, c.name, c.phone || "", c.email || "", c.address || "", c.leadCount || 0, c.createdAt, c.updatedAt]
      );
    }
    console.log(`Migrated ${contacts.length} contacts.`);

    // --- leads
    for (const l of leads) {
      const assignedPmId = PM_MANAGER_MAP[l.manager] || null;
      await client.query(
        `INSERT INTO leads (
           id, tenant_id, assigned_pm_id, contact_id, name, stage, created_at, start_date, revenue,
           won_at, paid_at, source, source_other, archived, archived_at, job, phone, email, address,
           bid_sent_at, completed_at, material_cost, labor_cost, commission, report_completed_at,
           last_report_reminder_at, went_well, went_wrong, actual_work_days, appointment_at,
           appointment_reminder_sent_at, lost_at, scope_of_work, follow_ups
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
           $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
         ) ON CONFLICT (id) DO NOTHING`,
        [
          l.id, TARGET_TENANT_ID, assignedPmId, l.contactId || null, l.name, l.stage, l.createdAt,
          toIso(l.startDate), l.revenue, toIso(l.wonAt), toIso(l.paidAt), l.source, l.sourceOther || "",
          toBool(l.archived), toIso(l.archivedAt), l.job || "", l.phone || "", l.email || "", l.address || "",
          toIso(l.bidSentAt), toIso(l.completedAt), l.materialCost, l.laborCost, l.commission,
          toIso(l.reportCompletedAt), toIso(l.lastReportReminderAt), l.wentWell || "", l.wentWrong || "",
          l.actualWorkDays, toIso(l.appointmentAt), toIso(l.appointmentReminderSentAt), toIso(l.lostAt),
          toJsonArray(l.scopeOfWork), toJsonArray(l.followUps),
        ]
      );
    }
    console.log(`Migrated ${leads.length} leads.`);

    // --- warranty requests + photos
    for (const w of warrantyRequests) {
      const assignedPmId = PM_MANAGER_MAP[w.manager] || null;
      await client.query(
        `INSERT INTO warranty_requests (id, tenant_id, assigned_pm_id, name, phone, email, issue, stage, created_at, scheduled_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
        [w.id, TARGET_TENANT_ID, assignedPmId, w.name, w.phone || "", w.email || "", w.issue || "", w.stage, w.createdAt, toIso(w.scheduledAt), toIso(w.resolvedAt)]
      );
    }
    for (const p of warrantyPhotos) {
      await client.query(
        `INSERT INTO warranty_photos (id, tenant_id, request_id, filename, type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [p.id, TARGET_TENANT_ID, p.requestId, p.filename, p.type, p.createdAt]
      );
    }
    console.log(`Migrated ${warrantyRequests.length} warranty requests, ${warrantyPhotos.length} warranty photos.`);
    console.log(
      "NOTE: warranty photo FILES were not copied -- copy the old WARRANTY_PHOTOS_DIR contents " +
        "into the new deployment's UPLOADS_DIR/warranty-photos separately."
    );

    // --- tenant-wide settings
    if (Object.keys(settings).length) {
      await client.query(
        `UPDATE tenant_settings SET
           overhead_percent = COALESCE($2, overhead_percent),
           popup_push_enabled = COALESCE($3, popup_push_enabled),
           popup_goal_enabled = COALESCE($4, popup_goal_enabled),
           popup_warranty_enabled = COALESCE($5, popup_warranty_enabled),
           popup_missing_info_enabled = COALESCE($6, popup_missing_info_enabled),
           popup_maps_enabled = COALESCE($7, popup_maps_enabled),
           goal_national_win_rate = COALESCE($8, goal_national_win_rate),
           goal_national_avg_job_value = COALESCE($9, goal_national_avg_job_value),
           goal_national_profit_margin = COALESCE($10, goal_national_profit_margin)
         WHERE tenant_id = $1`,
        [
          TARGET_TENANT_ID,
          settings.overheadPercent ? Number(settings.overheadPercent) : null,
          settings.popupPushEnabled === undefined ? null : settings.popupPushEnabled !== "0",
          settings.popupGoalEnabled === undefined ? null : settings.popupGoalEnabled !== "0",
          settings.popupWarrantyEnabled === undefined ? null : settings.popupWarrantyEnabled !== "0",
          settings.popupMissingInfoEnabled === undefined ? null : settings.popupMissingInfoEnabled !== "0",
          settings.popupMapsEnabled === undefined ? null : settings.popupMapsEnabled !== "0",
          settings.goalNationalWinRate ? Number(settings.goalNationalWinRate) : null,
          settings.goalNationalAvgJobValue ? Number(settings.goalNationalAvgJobValue) : null,
          settings.goalNationalProfitMargin ? Number(settings.goalNationalProfitMargin) : null,
        ]
      );

      // the old single global income goal becomes the tenant admin's personal goal
      if (settings.goalMonthlyTakeHome || settings.goalMonthlyOverhead) {
        await client.query(
          `INSERT INTO user_goals (id, tenant_id, user_id, monthly_take_home, monthly_overhead, data_source, month_confirmed)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET
             monthly_take_home = EXCLUDED.monthly_take_home,
             monthly_overhead = EXCLUDED.monthly_overhead,
             data_source = EXCLUDED.data_source,
             month_confirmed = EXCLUDED.month_confirmed`,
          [
            TARGET_TENANT_ID,
            tenantAdminId,
            settings.goalMonthlyTakeHome ? Number(settings.goalMonthlyTakeHome) : null,
            settings.goalMonthlyOverhead ? Number(settings.goalMonthlyOverhead) : null,
            settings.goalDataSource === "mine" ? "mine" : "national",
            settings.goalMonthConfirmed || null,
          ]
        );
      }
      console.log("Migrated tenant-wide settings and the tenant admin's income goal.");
    }
  });

  sqlite.close();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => closePools());
