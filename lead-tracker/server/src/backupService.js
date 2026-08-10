import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH } from "./db.js";
import { maybeSendBackupEmail } from "./emailBackup.js";

// JSON snapshots of the leads table (not a raw file copy of the sqlite db)
// so a restore is a plain transaction against the live connection — no
// swapping files or restarting the process, and it stays correct even as
// the schema gains columns over time.
const BACKUPS_ROOT = path.join(path.dirname(DB_PATH), "backups");

// each tier only takes a fresh snapshot once minGapMs has passed since its
// last one, and keeps at most maxCount — a simple "copy forward" rotation
// that ends up giving fine-grained recent history and coarser older history
const TIERS = [
  { name: "5min", dir: "5min", minGapMs: 0, maxCount: 24 }, // every tick, ~2h of history
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
  setInterval(tick, 5 * 60 * 1000);
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
