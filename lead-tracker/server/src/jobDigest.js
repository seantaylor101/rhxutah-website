import { db } from "./db.js";
import { sendPushToRole } from "./pushService.js";
import { BUSINESS_TZ } from "./businessTime.js";
import { parseJobDetails, JOB_EQUIPMENT } from "./jobDetails.js";

const SWEEP_MS = 5 * 60 * 1000;

function localDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

// see appointmentDigest.js's localHour for why the % 24 guard is here
function localHour(date) {
  const raw = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", hour12: false }).format(date)
  );
  return raw % 24;
}

function readSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : "";
}

function writeSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key, value });
}

// won/scheduled jobs whose start date lands on the given local calendar day —
// startDate is already a plain "YYYY-MM-DD", so it compares directly
function jobsStartingOn(dateKey) {
  return db
    .prepare(`SELECT * FROM leads WHERE stage IN ('won', 'scheduled') AND archived = 0 AND startDate = ?`)
    .all(dateKey);
}

function jobsInProgress() {
  return db.prepare(`SELECT * FROM leads WHERE stage = 'progress' AND archived = 0 ORDER BY startDate`).all();
}

function fmtShortDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

function jobLabel(lead) {
  return `${lead.name}${lead.job ? ` (${lead.job})` : ""}`;
}

// one line per job, plus the prep the PM needs to know about before heading
// out: materials not ordered yet (or not in yet), pick-ups still to grab on
// the way, and any special equipment to load
function startingJobLine(lead, dateKey) {
  const details = parseJobDetails(lead.jobDetails);
  const notes = [];
  const m = details.materials;
  if (!m.ordered) notes.push("materials NOT ordered");
  else if (m.availability === "date" && m.availableDate > dateKey) {
    notes.push(`materials from ${m.supplier} not ready until ${fmtShortDate(m.availableDate)}`);
  } else notes.push(`materials: ${m.supplier}`);
  const pickups = details.pickups.filter((p) => !p.done);
  if (pickups.length) notes.push(`pick up: ${pickups.map((p) => (p.where ? `${p.text} @ ${p.where}` : p.text)).join(", ")}`);
  const equipment = details.equipment.map((k) => JOB_EQUIPMENT[k]).filter(Boolean);
  if (equipment.length) notes.push(`bring: ${equipment.join(", ")}`);
  return `• ${jobLabel(lead)}${notes.length ? ` — ${notes.join("; ")}` : ""}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// a single-job digest deep-links straight into that job's profile
function leadIdFor(leads) {
  return leads.length === 1 ? leads[0].id : undefined;
}

// Two once-a-day pushes to the project manager (viewer role), mirroring the
// owner's appointment digests in appointmentDigest.js:
//   - 7am: jobs lined up to start today + jobs currently in progress
//   - 8pm: jobs starting tomorrow, with the prep each one needs
// Dedup'd by local calendar date in settings so a late-starting server still
// catches up instead of skipping the day. Unlike the appointment digest,
// nothing is sent when there's nothing to report — the PM doesn't need a
// nightly "no jobs tomorrow" push (the day is still marked handled).
export async function sendDueJobDigests() {
  const now = new Date();
  const hour = localHour(now);
  const todayKey = localDateKey(now);

  if (hour >= 7 && readSetting("jobMorningDigestSentDate") !== todayKey) {
    writeSetting("jobMorningDigestSentDate", todayKey);
    const starting = jobsStartingOn(todayKey);
    const inProgress = jobsInProgress();
    if (starting.length || inProgress.length) {
      const titleParts = [];
      if (starting.length) titleParts.push(`${plural(starting.length, "job")} starting today`);
      if (inProgress.length) titleParts.push(`${inProgress.length} in progress`);
      const sections = [];
      if (starting.length) sections.push(`Starting today:\n${starting.map((l) => startingJobLine(l, todayKey)).join("\n")}`);
      if (inProgress.length) sections.push(`In progress:\n${inProgress.map((l) => `• ${jobLabel(l)}`).join("\n")}`);
      await sendPushToRole("viewer", {
        title: titleParts.join(" · "),
        body: sections.join("\n\n"),
        leadId: leadIdFor([...starting, ...inProgress]),
      }).catch((err) => console.error("morning job digest push failed:", err.message));
    }
  }

  if (hour >= 20 && readSetting("jobEveningDigestSentDate") !== todayKey) {
    writeSetting("jobEveningDigestSentDate", todayKey);
    const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const starting = jobsStartingOn(tomorrowKey);
    if (starting.length) {
      await sendPushToRole("viewer", {
        title: `${plural(starting.length, "job")} starting tomorrow`,
        body: starting.map((l) => startingJobLine(l, tomorrowKey)).join("\n"),
        leadId: leadIdFor(starting),
      }).catch((err) => console.error("evening job digest push failed:", err.message));
    }
  }
}

export function startJobDigestScheduler() {
  sendDueJobDigests().catch((err) => console.error("job digest sweep failed:", err.message));
  setInterval(() => {
    sendDueJobDigests().catch((err) => console.error("job digest sweep failed:", err.message));
  }, SWEEP_MS);
}
