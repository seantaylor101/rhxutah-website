import { Router } from "express";
import { randomUUID } from "node:crypto";
import { withTenant } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { localMonthKey } from "../businessTime.js";

const router = Router();

function rowToGoal(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    monthlyTakeHome: row.monthly_take_home === null ? null : Number(row.monthly_take_home),
    monthlyOverhead: row.monthly_overhead === null ? null : Number(row.monthly_overhead),
    dataSource: row.data_source,
    monthConfirmed: row.month_confirmed,
  };
}

async function getOrCreateGoal(client, tenantId, userId) {
  const { rows } = await client.query(`SELECT * FROM user_goals WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
  if (rows.length) return rows[0];
  const { rows: created } = await client.query(
    `INSERT INTO user_goals (id, tenant_id, user_id) VALUES ($1, $2, $3) RETURNING *`,
    [randomUUID(), tenantId, userId]
  );
  return created[0];
}

// Every tenant user (admin or PM) manages their own income goal -- this replaces the old
// single global goal that used to belong to whoever happened to be signed in as "owner".
router.get("/me", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { tenantId, userId } = req.effective;
    await withTenant(tenantId, async (client) => {
      const row = await getOrCreateGoal(client, tenantId, userId);
      res.json(rowToGoal(row));
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/me", requireAuth("tenant_admin", "pm"), async (req, res, next) => {
  try {
    const { tenantId, userId } = req.effective;
    const body = req.body || {};
    const updates = {};

    if (body.monthlyTakeHome !== undefined) {
      const n = Number(body.monthlyTakeHome);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "monthlyTakeHome must be a non-negative number" });
      updates.monthly_take_home = n;
      // touching the take-home goal counts as confirming it for whichever month that
      // happens in, computed server-side rather than trusted from the client.
      updates.month_confirmed = localMonthKey();
    }
    if (body.monthlyOverhead !== undefined) {
      const n = Number(body.monthlyOverhead);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "monthlyOverhead must be a non-negative number" });
      updates.monthly_overhead = n;
    }
    if (body.dataSource !== undefined) {
      if (body.dataSource !== "national" && body.dataSource !== "mine") {
        return res.status(400).json({ error: "dataSource must be 'national' or 'mine'" });
      }
      updates.data_source = body.dataSource;
    }

    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ error: "No editable fields given" });

    await withTenant(tenantId, async (client) => {
      await getOrCreateGoal(client, tenantId, userId);
      const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
      await client.query(
        `UPDATE user_goals SET ${setClauses.join(", ")}, updated_at = now() WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId, ...keys.map((k) => updates[k])]
      );
      const { rows } = await client.query(`SELECT * FROM user_goals WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
      res.json(rowToGoal(rows[0]));
    });
  } catch (err) {
    next(err);
  }
});

// Tenant-admin-only rollup of every PM's (and the admin's own) goal + this month's
// progress, joined against won-job revenue -- the "see all PMs' numbers" view.
router.get("/", requireAuth("tenant_admin"), async (req, res, next) => {
  try {
    const { tenantId } = req.effective;
    await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT g.*, u.name AS user_name, u.role AS user_role
         FROM user_goals g JOIN users u ON u.id = g.user_id
         WHERE g.tenant_id = $1
         ORDER BY u.role, lower(u.name)`,
        [tenantId]
      );
      res.json(rows.map((r) => ({ ...rowToGoal(r), userName: r.user_name, userRole: r.user_role })));
    });
  } catch (err) {
    next(err);
  }
});

export default router;
