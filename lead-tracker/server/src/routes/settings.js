import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

function readSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    overheadPercent: Number(map.overheadPercent ?? 13),
    goalMonthlyTakeHome: Number(map.goalMonthlyTakeHome ?? 0),
    // fixed monthly business overhead (bills, salaried staff like a project
    // manager) that has to be covered before any job profit becomes the
    // owner's take-home — separate from overheadPercent above, which is a
    // per-job allocation used in job costing, not a flat recurring cost
    goalMonthlyOverhead: Number(map.goalMonthlyOverhead ?? 0),
    goalDataSource: map.goalDataSource === "mine" ? "mine" : "national",
    // starting assumptions for the income-goal calculator's "national
    // averages" mode, meant to be edited to fit whatever business is
    // actually using this. Sourced (Aug 2026): ~20-30% average close rate
    // for renovation/home-improvement contractors (Hook Agency, home
    // services industry benchmarks); ~$9,500 national average roof
    // replacement cost, as a representative exterior-trades job value
    // (HomeGuide, RoofingCalc); ~24% average GROSS profit margin for
    // construction businesses (ServiceTitan, Procore) — deliberately the
    // gross figure (revenue minus materials/labor/typical per-job costs),
    // not the ~7-8% bottom-line net figure, since goalMonthlyOverhead
    // above is subtracted separately in the plan math rather than baked
    // into this percentage. Remodeling/specialty trades commonly run
    // higher (30-40%+) than the all-construction average — edit to match
    goalNationalWinRate: Number(map.goalNationalWinRate ?? 25),
    goalNationalAvgJobValue: Number(map.goalNationalAvgJobValue ?? 9500),
    goalNationalProfitMargin: Number(map.goalNationalProfitMargin ?? 24),
  };
}

router.get("/", requireAuth("viewer"), (req, res) => {
  const settings = readSettings();
  // the income-goal figures are the owner's personal take-home target —
  // keep them out of the viewer-role response, same as job cost/profit
  // fields are stripped on the leads API
  if (req.role !== "owner") {
    settings.goalMonthlyTakeHome = null;
    settings.goalMonthlyOverhead = null;
    settings.goalDataSource = null;
    settings.goalNationalWinRate = null;
    settings.goalNationalAvgJobValue = null;
    settings.goalNationalProfitMargin = null;
  }
  res.json(settings);
});

const GOAL_NUMBER_FIELDS = {
  goalMonthlyTakeHome: (n) => Number.isFinite(n) && n >= 0,
  goalMonthlyOverhead: (n) => Number.isFinite(n) && n >= 0,
  goalNationalWinRate: (n) => Number.isFinite(n) && n > 0 && n <= 100,
  goalNationalAvgJobValue: (n) => Number.isFinite(n) && n > 0,
  goalNationalProfitMargin: (n) => Number.isFinite(n) && n > 0 && n <= 100,
};

router.patch("/", requireAuth("owner"), (req, res) => {
  const body = req.body || {};
  const updates = {};

  if (body.overheadPercent !== undefined) {
    const n = Number(body.overheadPercent);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: "overheadPercent must be a non-negative number" });
    }
    updates.overheadPercent = n;
  }

  for (const [key, isValid] of Object.entries(GOAL_NUMBER_FIELDS)) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!isValid(n)) {
      return res.status(400).json({ error: `${key} is out of range` });
    }
    updates[key] = n;
  }

  if (body.goalDataSource !== undefined) {
    if (body.goalDataSource !== "national" && body.goalDataSource !== "mine") {
      return res.status(400).json({ error: "goalDataSource must be 'national' or 'mine'" });
    }
    updates.goalDataSource = body.goalDataSource;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No editable fields given" });
  }

  const stmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  );
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) stmt.run({ key, value: String(value) });
  });
  tx(Object.entries(updates));

  res.json(readSettings());
});

export default router;
