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
if (!existingColumns.has("commission")) {
  db.exec(`ALTER TABLE leads ADD COLUMN commission REAL`);
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
if (!existingColumns.has("address")) {
  db.exec(`ALTER TABLE leads ADD COLUMN address TEXT DEFAULT ''`);
}
if (!existingColumns.has("lostAt")) {
  // when a lead was actually marked lost — previously the "lost" stage had
  // no timestamp of its own, so a lead moved to lost couldn't be attributed
  // to a month for reporting the way every other stage transition can
  db.exec(`ALTER TABLE leads ADD COLUMN lostAt TEXT`);
}
if (!existingColumns.has("scopeOfWork")) {
  // JSON-encoded array of { id, text, done } checklist items, filled out
  // right after a lead is marked won so the project manager knows exactly
  // what to plan for and who to hire
  db.exec(`ALTER TABLE leads ADD COLUMN scopeOfWork TEXT DEFAULT ''`);
}
if (!existingColumns.has("followUps")) {
  // JSON-encoded array of { id, createdAt } — one entry per logged
  // follow-up call/text/email while a lead sits in "bid", so the owner can
  // both see the running count on a lead and measure whether following up
  // more actually correlates with winning the job
  db.exec(`ALTER TABLE leads ADD COLUMN followUps TEXT DEFAULT ''`);
}
if (!existingColumns.has("contactId")) {
  // which contacts-table row this lead is tied to, set once at creation.
  // Later edits to name/phone/email/address update that same contact
  // directly instead of re-matching from scratch — re-matching after an
  // edit (e.g. the phone just changed) can no longer find the old link and
  // would spin up a duplicate contact instead of updating the real one.
  db.exec(`ALTER TABLE leads ADD COLUMN contactId TEXT`);
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

// audit trail of every lead/warranty-request stage move, for the owner's
// "who moved what, when" activity log
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entityId TEXT NOT NULL,
    entityName TEXT NOT NULL,
    fromStage TEXT,
    toStage TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_createdAt ON activity_log (createdAt DESC)`);

// records every time the viewer (project manager) role opens the app, so
// the owner can see how often it's actually being used
db.exec(`
  CREATE TABLE IF NOT EXISTS access_log (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_access_log_createdAt ON access_log (createdAt DESC)`);

// owner-only address book, auto-populated as leads come in so a repeat
// customer's info doesn't have to be typed in twice. Lives in this same
// per-deployment sqlite file as everything else — there's no shared/cloud
// store behind it, so a contact entered here can never end up in a
// different business's copy of this app
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    leadCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name COLLATE NOCASE)`);
