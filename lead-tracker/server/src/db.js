import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "leads.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stage TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    startDate TEXT,
    revenue REAL,
    wonAt TEXT,
    paidAt TEXT,
    source TEXT,
    sourceOther TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    archivedAt TEXT
  );
`);

// migrations for columns added after the table already existed in production
const existingColumns = new Set(db.prepare(`PRAGMA table_info(leads)`).all().map((c) => c.name));
if (!existingColumns.has("job")) {
  db.exec(`ALTER TABLE leads ADD COLUMN job TEXT DEFAULT ''`);
}
if (!existingColumns.has("phone")) {
  db.exec(`ALTER TABLE leads ADD COLUMN phone TEXT DEFAULT ''`);
}
if (!existingColumns.has("email")) {
  db.exec(`ALTER TABLE leads ADD COLUMN email TEXT DEFAULT ''`);
}
if (!existingColumns.has("bidSentAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN bidSentAt TEXT`);
}
if (!existingColumns.has("completedAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN completedAt TEXT`);
}
if (!existingColumns.has("materialCost")) {
  db.exec(`ALTER TABLE leads ADD COLUMN materialCost REAL`);
}
if (!existingColumns.has("laborCost")) {
  db.exec(`ALTER TABLE leads ADD COLUMN laborCost REAL`);
}
if (!existingColumns.has("reportCompletedAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN reportCompletedAt TEXT`);
}
if (!existingColumns.has("lastReportReminderAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN lastReportReminderAt TEXT`);
}
if (!existingColumns.has("wentWell")) {
  db.exec(`ALTER TABLE leads ADD COLUMN wentWell TEXT DEFAULT ''`);
}
if (!existingColumns.has("wentWrong")) {
  db.exec(`ALTER TABLE leads ADD COLUMN wentWrong TEXT DEFAULT ''`);
}
if (!existingColumns.has("actualWorkDays")) {
  db.exec(`ALTER TABLE leads ADD COLUMN actualWorkDays REAL`);
}
if (!existingColumns.has("appointmentAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN appointmentAt TEXT`);
}
if (!existingColumns.has("appointmentReminderSentAt")) {
  db.exec(`ALTER TABLE leads ADD COLUMN appointmentReminderSentAt TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

// which role was signed in on the device when it subscribed — lets a
// notification target just the owner or just the viewer instead of every
// registered device. Subscriptions saved before this column existed have no
// role on file until that device unsubscribes/resubscribes (e.g. toggling
// push off and back on in Account settings).
if (!db.prepare(`PRAGMA table_info(push_subscriptions)`).all().some((c) => c.name === "role")) {
  db.exec(`ALTER TABLE push_subscriptions ADD COLUMN role TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    leadId TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    readAt TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('overheadPercent', '13')`).run();

db.exec(`
  CREATE TABLE IF NOT EXISTS warranty_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    issue TEXT DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'reported',
    createdAt TEXT NOT NULL,
    scheduledAt TEXT,
    resolvedAt TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS warranty_photos (
    id TEXT PRIMARY KEY,
    requestId TEXT NOT NULL,
    filename TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'before',
    createdAt TEXT NOT NULL
  );
`);
