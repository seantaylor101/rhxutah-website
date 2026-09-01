import { db } from "./db.js";
import { sendPushToRole } from "./pushService.js";
import { localMonthKey } from "./businessTime.js";

function readGoalMonthFields() {
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN ('goalMonthConfirmed', 'goalMonthPushSentMonth')`)
    .all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { confirmed: map.goalMonthConfirmed || "", pushSent: map.goalMonthPushSentMonth || "" };
}

function markPushSent(monthKey) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('goalMonthPushSentMonth', @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ value: monthKey });
}

// nudges the owner once at the start of a new month if that month's income
// goal hasn't been (re)confirmed yet — mirrors the in-app monthly prompt,
// but as a push so it reaches them even before they next open the app.
// goalMonthPushSentMonth is internal bookkeeping (not part of the public
// settings API) purely to keep this to one push per month, not one per
// hourly sweep.
export async function sendDueGoalReminder() {
  const monthKey = localMonthKey();
  const { confirmed, pushSent } = readGoalMonthFields();
  if (confirmed === monthKey) return;
  if (pushSent === monthKey) return;

  // mark first, before the async send, so a second sweep landing mid-flight
  // can't fire a duplicate
  markPushSent(monthKey);
  await sendPushToRole("owner", {
    title: "New month, new goal",
    body: "How much do you want to make this month? Set your income goal in the app.",
  }).catch((err) => console.error("goal reminder push failed:", err.message));
}

export function startGoalReminderScheduler() {
  sendDueGoalReminder().catch((err) => console.error("goal reminder sweep failed:", err.message));
  setInterval(() => {
    sendDueGoalReminder().catch((err) => console.error("goal reminder sweep failed:", err.message));
  }, 60 * 60 * 1000);
}
