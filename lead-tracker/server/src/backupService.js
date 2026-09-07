import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "./db.js";
import { maybeSendBackupEmail } from "./emailBackup.js";
import { BUSINESS_TZ } from "./businessTime.js";

// JSON snapshots of the leads table (not a raw file copy of the sqlite db)
// so a restore is a plain transaction against the live connection — no
// swapping files or restarting the process, and it stays correct even as
// the schema gains columns over time.
const BACKUPS_ROOT = path.join(path.dirname(DB_PATH), "backups");

// "the app is in use" is any request landing on the server at all — an
// admin/PM with the board open, or a new lead posted from the public
// website form with nobody logged in. Either way something changed that's
// worth a tight recovery point.
const ACTIVITY_WINDOW_MS = 3 * 60 * 1000;
let lastActivityAt = 0;
export function recordActivity(now = Date.now()) {
  lastActivityAt = now;
}

// fixed local checkpoints that fire regardless of activity, so an overnight
// gap with no one around still has a floor. Each is a few-minute window
// (not an exact instant) so a tick that lands a little early/late from
// process start-up drift still catches it.
const FIXED_LOCAL_TIMES = ["06:55", "23:00"];
const FIXED_WINDOW_MINUTES = 5;
const FIXED_MIN_GAP_MS = 10 * 60 * 60 * 1000; // don't double-fire within the same window

function localHHMM(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.hour}:${map.minute}`;
}

function withinFixedWindow(now) {
  const [nowH, nowM] = localHHMM(now).split(":").map(Number);
  const nowMinutes = nowH * 60 + nowM;
  return FIXED_LOCAL_TIMES.some((t) => {
    const [h, m] = t.split(":").map(Number);
    const target = h * 60 + m;
    return nowMinutes >= target && nowMinutes < target + FIXED_WINDOW_MINUTES;
  });
}

// each tier only takes a fresh snapshot once minGapMs has passed since its
// last one (and, for "active"/"fixed", only when their own extra condition
// is also true), and keeps at most maxCount — a simple "copy forward"
// rotation that ends up giving fine-grained recent history and coarser
// older history
const TIERS = [
  // while someone/something is actively hitting the server: every 2 min, ~2h of history
  { name: "active", dir: "active", minGapMs: 2 * 60 * 1000, maxCount: 60, when: (now) => now - lastActivityAt <= ACTIVITY_WINDOW_MS },
  // fixed 6:55am / 11pm business-local checkpoints, active or not: ~30 days of twice-daily history
  { name: "fixed", dir: "fixed", minGapMs: FIXED_MIN_GAP_MS, maxCount: 60, when: (now) => withinFixedWindow(now) },
  { name: "hourly", dir: "hourly", minGapMs: 55 * 60 * 1000, maxCount: 48 }, // ~48h
  { name: "daily", dir: "daily", minGapMs: 23 * 60 * 60 * 1000, maxCount: 30 }, // ~30 days
  { name: "weekly", dir: "weekly", minGapMs: 6.5 * 24 * 60 * 60 * 1000, maxCount: 12 }, // ~12 weeks
];

function ensureDirs() {
  for (const tier of TIERS) fs.mkdirSync(path.join(BACKUPS_ROOT, tier.dir), { recursive: true });
}

function listJsonFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // filenames are epoch millis, so lexical sort == chronological
}

function snapshotLeads(now) {
  const leads = db.prepare(`SELECT * FROM leads ORDER BY createdAt`).all();
  return { takenAt: new Date(now).toISOString(), leads };
}

export function runBackupTick(now = Date.now()) {
  ensureDirs();
  const snapshot = snapshotLeads(now);
  const json = JSON.stringify(snapshot);

  for (const tier of TIERS) {
    if (tier.when && !tier.when(now)) continue;

    const dir = path.join(BACKUPS_ROOT, tier.dir);
    const files = listJsonFiles(dir);
    const lastTime = files.length ? Number(path.basename(files[files.length - 1], ".json")) : 0;
    if (now - lastTime < tier.minGapMs) continue;

    fs.writeFileSync(path.join(dir, `${now}.json`), json);

    const updated = listJsonFiles(dir);
    while (updated.length > tier.maxCount) {
      fs.unlinkSync(path.join(dir, updated.shift()));
    }
  }

  return snapshot;
}

export function startBackupScheduler() {
  const tick = () => {
    const snapshot = runBackupTick();
    maybeSendBackupEmail(snapshot).catch((err) => console.error("backup email failed:", err.message));
  };
  tick();
  // ticks every minute so the active (2 min) and fixed (6:55am/11pm) tiers
  // both get evaluated often enough to actually land; each tier's own
  // minGapMs/when() still gates whether that tick actually writes anything
  setInterval(tick, 60 * 1000);
}

export function listBackups() {
  ensureDirs();
  const result = [];
  for (const tier of TIERS) {
    const dir = path.join(BACKUPS_ROOT, tier.dir);
    for (const filename of listJsonFiles(dir).reverse()) {
      let leadCount = null;
      let takenAt = new Date(Number(path.basename(filename, ".json"))).toISOString();
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, filename), "utf8"));
        leadCount = Array.isArray(data.leads) ? data.leads.length : null;
        takenAt = data.takenAt || takenAt;
      } catch {
        // corrupt/unreadable snapshot — still list it so it isn't silently invisible
      }
      result.push({ tier: tier.name, filename, takenAt, leadCount });
    }
  }
  return result;
}

function findBackupFile(filename) {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  for (const tier of TIERS) {
    const candidate = path.join(BACKUPS_ROOT, tier.dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function restoreBackup(filename) {
  const filePath = findBackupFile(filename);
  if (!filePath) throw new Error("Backup not found");

  // safety net: snapshot current state before overwriting it, so a bad
  // restore choice is itself reversible
  runBackupTick();

  const backup = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rows = Array.isArray(backup.leads) ? backup.leads : [];

  const tx = db.transaction((leadRows) => {
    db.prepare(`DELETE FROM leads`).run();
    if (!leadRows.length) return;
    const cols = Object.keys(leadRows[0]);
    const insert = db.prepare(
      `INSERT INTO leads (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})`
    );
    for (const row of leadRows) insert.run(row);
  });
  tx(rows);

  return { restoredCount: rows.length, takenAt: backup.takenAt };
}
