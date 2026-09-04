import { Router } from "express";
import { randomBytes } from "node:crypto";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();

// Opaque token gating the public, unauthenticated per-tenant calendar-subscription feed
// (Apple Calendar's fetcher can't carry the app's session cookie) -- generated once per
// tenant on first use.
export async function getOrCreateCalendarFeedToken(client, tenantId) {
  const { rows } = await client.query(`SELECT token FROM calendar_feed_tokens WHERE tenant_id = $1`, [tenantId]);
  if (rows[0]?.token) return rows[0].token;
  const token = randomBytes(24).toString("hex");
  await client.query(
    `INSERT INTO calendar_feed_tokens (tenant_id, token) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET token = calendar_feed_tokens.token RETURNING token`,
    [tenantId, token]
  );
  const { rows: after } = await client.query(`SELECT token FROM calendar_feed_tokens WHERE tenant_id = $1`, [tenantId]);
  return after[0].token;
}

function rowToSettings(row, calendarFeedToken) {
  return {
    overheadPercent: Number(row.overhead_percent),
    calendarFeedToken,
    popupPushEnabled: row.popup_push_enabled,
    popupGoalEnabled: row.popup_goal_enabled,
    popupWarrantyEnabled: row.popup_warranty_enabled,
    popupMissingInfoEnabled: row.popup_missing_info_enabled,
    popupMapsEnabled: row.popup_maps_enabled,
    // Starting assumptions for the income-goal calculator's "national averages" mode --
    // tenant-editable, not proprietary per-user data, so visible to every tenant user.
    goalNationalWinRate: Number(row.goal_national_win_rate ?? 25),
    goalNationalAvgJobValue: Number(row.goal_national_avg_job_value ?? 9500),
    goalNationalProfitMargin: Number(row.goal_national_profit_margin ?? 24),
  };
}

router.get("/", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { tenantId } = req.effective;
    await withTenant(tenantId, async (client) => {
      const token = await getOrCreateCalendarFeedToken(client, tenantId);
      const { rows } = await client.query(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
      res.json(rowToSettings(rows[0], token));
    });
  } catch (err) {
    next(err);
  }
});

const NUMBER_FIELDS = {
  overheadPercent: { column: "overhead_percent", isValid: (n) => Number.isFinite(n) && n >= 0 },
  goalNationalWinRate: { column: "goal_national_win_rate", isValid: (n) => Number.isFinite(n) && n > 0 && n <= 100 },
  goalNationalAvgJobValue: { column: "goal_national_avg_job_value", isValid: (n) => Number.isFinite(n) && n > 0 },
  goalNationalProfitMargin: { column: "goal_national_profit_margin", isValid: (n) => Number.isFinite(n) && n > 0 && n <= 100 },
};

const POPUP_FIELDS = {
  popupPushEnabled: "popup_push_enabled",
  popupGoalEnabled: "popup_goal_enabled",
  popupWarrantyEnabled: "popup_warranty_enabled",
  popupMissingInfoEnabled: "popup_missing_info_enabled",
  popupMapsEnabled: "popup_maps_enabled",
};

router.patch("/", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { tenantId } = req.effective;
    const body = req.body || {};
    const updates = {};

    for (const [key, { column, isValid }] of Object.entries(NUMBER_FIELDS)) {
      if (body[key] === undefined) continue;
      const n = Number(body[key]);
      if (!isValid(n)) return res.status(400).json({ error: `${key} is out of range` });
      updates[column] = n;
    }
    for (const [key, column] of Object.entries(POPUP_FIELDS)) {
      if (body[key] === undefined) continue;
      updates[column] = !!body[key];
    }

    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ error: "No editable fields given" });

    await withTenant(tenantId, async (client) => {
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
      await client.query(`UPDATE tenant_settings SET ${setClauses.join(", ")} WHERE tenant_id = $1`, [
        tenantId,
        ...keys.map((k) => updates[k]),
      ]);
      const token = await getOrCreateCalendarFeedToken(client, tenantId);
      const { rows } = await client.query(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
      res.json(rowToSettings(rows[0], token));
    });
  } catch (err) {
    next(err);
  }
});

export default router;
